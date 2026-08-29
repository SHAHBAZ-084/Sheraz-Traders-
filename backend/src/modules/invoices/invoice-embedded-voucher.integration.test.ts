import { AccountType, VoucherType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  bootstrapChartOfAccounts,
  KACHI_MAAL_CATEGORY_NAMES,
} from '../accounting/accounting.service';
import { createProduct } from '../products/products.service';
import { createStore } from '../stores/stores.service';
import { createSaleInvoice } from './sale-invoice.service';
import { getSaleBillSummary } from './sale-bill-report.service';

async function ensureAccountInCategory(
  categoryName: string,
  accountName: string,
  type: AccountType,
  code: string,
) {
  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: categoryName },
  });
  if (!category) throw new Error(`Category missing: ${categoryName}`);

  let account = await prisma.account.findFirst({
    where: { code },
    include: { ledger: true },
  });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name: accountName, code, type },
      include: { ledger: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  } else if (!account.ledger) {
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  }
  return account;
}

describe('embedded invoice vouchers and sale bill report (focused)', () => {
  let userId: number;
  let storeId: number;
  let productId: number;
  let customerAccountId: number;
  let cashAccountId: number;
  let invoiceDate: string;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('seed user required');
    userId = user.id;

    storeId = (await createStore(`Embed Store ${Date.now()}`)).id;

    productId = (
      await createProduct(
        {
          name: `Embed Product ${Date.now()}`,
          code: `EP${Date.now()}`,
          unit: 'bag',
          categoryName: 'Grain',
          openingStoreId: storeId,
          openingStock: 100,
          openingStockRate: 50,
        },
        { postImmediately: true, createdById: userId },
      )
    ).id;

    customerAccountId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        'Embed Sale Party',
        AccountType.ASSET,
        `ESP-${Date.now()}`,
      )
    ).id;

    const cash = await prisma.account.findFirst({
      where: { category: { name: { contains: 'Cash' } }, isActive: true },
    });
    if (!cash) throw new Error('cash account required');
    cashAccountId = cash.id;
  });

  it('does not create SALE_RECEIPT when invoice includes receipt (folded into SALE_INVOICE)', async () => {
    const fy = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
    if (!fy) throw new Error('active FY required');

    const saleReceiptMaxBefore = await prisma.voucher.aggregate({
      where: { financialYearId: fy.id, type: VoucherType.SALE_RECEIPT },
      _max: { number: true },
    });

    const invoice = await createSaleInvoice(
      {
        invoiceDate,
        storeId,
        customerAccountId,
        createdById: userId,
        receiptAmount: 250,
        receiptAccountId: cashAccountId,
        lines: [{ productId, quantity: 2, rate: 200 }],
      },
      { postImmediately: true },
    );

    const embeddedReceipt = await prisma.voucher.findFirst({
      where: {
        type: VoucherType.SALE_RECEIPT,
        invoiceLink: { invoiceId: invoice.id },
      },
    });
    expect(embeddedReceipt).toBeNull();

    const saleInvoice = await prisma.voucher.findFirst({
      where: { type: VoucherType.SALE_INVOICE, invoiceLink: { invoiceId: invoice.id } },
      include: {
        ledgerEntries: { where: { isReversal: false } },
      },
    });
    expect(saleInvoice).toBeTruthy();
    expect(
      saleInvoice!.ledgerEntries.some((e) => (e.notes ?? '').includes('Receipt against Invoice')),
    ).toBe(true);

    const saleReceiptMaxAfter = await prisma.voucher.aggregate({
      where: { financialYearId: fy.id, type: VoucherType.SALE_RECEIPT },
      _max: { number: true },
    });
    expect(saleReceiptMaxAfter._max.number ?? 0).toBe(saleReceiptMaxBefore._max.number ?? 0);
  });

  it('sale bill report counts folded receipts as received on posted invoices', async () => {
    const invoiceA = await createSaleInvoice(
      {
        invoiceDate,
        storeId,
        customerAccountId,
        createdById: userId,
        receiptAmount: 300,
        receiptAccountId: cashAccountId,
        lines: [{ productId, quantity: 1, rate: 500 }],
      },
      { postImmediately: true },
    );

    const invoiceB = await createSaleInvoice(
      {
        invoiceDate,
        storeId,
        customerAccountId,
        createdById: userId,
        lines: [{ productId, quantity: 1, rate: 220 }],
      },
      { postImmediately: true },
    );

    const report = await getSaleBillSummary({ fromDate: invoiceDate, toDate: invoiceDate });
    const rowA = report.invoices.find((r) => r.invoiceId === invoiceA.id);
    const rowB = report.invoices.find((r) => r.invoiceId === invoiceB.id);

    expect(rowA?.receivedAmount).toBe(300);
    expect(rowA?.receivedPending).toBe(false);
    expect(rowA?.netTotal).toBe(500);
    expect(rowB?.receivedAmount).toBe(0);
    expect(rowB?.netTotal).toBe(220);
  });
});
