import { AccountType, VoucherStatus, VoucherType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  bootstrapChartOfAccounts,
  createVoucher,
  KACHI_MAAL_CATEGORY_NAMES,
} from '../accounting/accounting.service';
import { approvePendingVoucher } from '../approvals/approvals.service';
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

  it('uses independent SALE_RECEIPT numbering from standalone RECEIPT', async () => {
    const fy = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
    if (!fy) throw new Error('active FY required');

    const receiptMax = await prisma.voucher.aggregate({
      where: { financialYearId: fy.id, type: VoucherType.RECEIPT },
      _max: { number: true },
    });
    const saleReceiptMax = await prisma.voucher.aggregate({
      where: { financialYearId: fy.id, type: VoucherType.SALE_RECEIPT },
      _max: { number: true },
    });

    const standalone = await createVoucher({
      type: VoucherType.RECEIPT,
      debitAccountId: cashAccountId,
      creditAccountId: customerAccountId,
      amount: 100,
      date: invoiceDate,
      reference: `RCPT-EMBED-${Date.now()}`,
      createdById: userId,
      postImmediately: false,
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

    expect(embeddedReceipt).toBeTruthy();
    expect(embeddedReceipt!.status).toBe(VoucherStatus.PENDING_APPROVAL);
    expect(embeddedReceipt!.number).toBe((saleReceiptMax._max.number ?? 0) + 1);
    expect(standalone.number).toBe((receiptMax._max.number ?? 0) + 1);
    expect(embeddedReceipt!.number).not.toBe(standalone.number);
  });

  it('sale bill report counts only approved embedded receipts in received total', async () => {
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

    let report = await getSaleBillSummary({ fromDate: invoiceDate, toDate: invoiceDate });
    const rowA = report.invoices.find((r) => r.invoiceId === invoiceA.id);
    const rowB = report.invoices.find((r) => r.invoiceId === invoiceB.id);

    expect(rowA?.receivedAmount).toBe(0);
    expect(rowA?.receivedPending).toBe(true);
    expect(rowA?.netTotal).toBe(500);
    expect(rowB?.receivedAmount).toBe(0);
    expect(rowB?.netTotal).toBe(220);

    const pendingReceipt = await prisma.voucher.findFirst({
      where: { type: VoucherType.SALE_RECEIPT, invoiceLink: { invoiceId: invoiceA.id } },
    });
    await approvePendingVoucher(pendingReceipt!.id, userId);

    report = await getSaleBillSummary({ fromDate: invoiceDate, toDate: invoiceDate });
    const rowAAfter = report.invoices.find((r) => r.invoiceId === invoiceA.id);
    expect(rowAAfter?.receivedAmount).toBe(300);
    expect(rowAAfter?.receivedPending).toBe(false);
  });
});
