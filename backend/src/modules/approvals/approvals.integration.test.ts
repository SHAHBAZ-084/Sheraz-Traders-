import { AccountType, InvoiceStatus, Role, VoucherStatus, VoucherType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { createVoucher, KACHI_MAAL_CATEGORY_NAMES, bootstrapChartOfAccounts } from '../accounting/accounting.service';
import { createProduct } from '../products/products.service';
import { createStore } from '../stores/stores.service';
import { createPurchaseInvoice } from '../invoices/purchase-invoice.service';
import { createSaleInvoice } from '../invoices/sale-invoice.service';
import { getCurrentStockBalance } from '../stock/stock.service';
import { approvePendingInvoice, approvePendingVoucher, listPendingApprovals } from './approvals.service';

async function ledgerBalance(accountId: number) {
  const ledger = await prisma.ledger.findUniqueOrThrow({ where: { accountId } });
  return Number(ledger.balance);
}

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
    where: { isActive: true, name: accountName, categoryId: category.id },
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

describe('Pending approval workflow', () => {
  let adminId: number;
  let userId: number;
  let cashId: number;
  let expenseId: number;
  let salePartyId: number;
  let purchasePartyId: number;
  let productId: number;
  let storeId: number;
  let invoiceDate: string;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    invoiceDate = await voucherDateInActiveYear();
    const admin = await prisma.user.findFirst({ where: { role: Role.ADMIN } });
    if (!admin) throw new Error('Seed admin first');
    adminId = admin.id;

    const username = `clerk_${Date.now()}`;
    const created = await prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash('clerk123', 10),
        displayName: 'Clerk User',
        role: Role.USER,
      },
    });
    userId = created.id;

    const cash = await prisma.account.findFirst({
      where: { isActive: true, name: 'Cash in Hand' },
    });
    if (!cash) throw new Error('Cash in Hand missing');
    cashId = cash.id;

    expenseId = (
      await ensureAccountInCategory(
        'Expenses',
        `Approval Expense ${Date.now()}`,
        AccountType.EXPENSE,
        `APP-EXP-${Date.now()}`,
      )
    ).id;

    salePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        `Approval Sale Party ${Date.now()}`,
        AccountType.ASSET,
        `APP-SP-${Date.now()}`,
      )
    ).id;
    purchasePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE,
        `Approval Purchase Party ${Date.now()}`,
        AccountType.LIABILITY,
        `APP-PP-${Date.now()}`,
      )
    ).id;

    productId = (await createProduct({ name: `Approval Product ${Date.now()}` })).id;
    storeId = (await createStore(`Approval Store ${Date.now()}`)).id;
  });

  it('USER voucher stays pending with no ledger impact until ADMIN approves', async () => {
    // Clean orphaned pending payment entries from prior failed approve attempts on shared DB.
    const orphans = await prisma.voucher.findMany({
      where: {
        status: VoucherStatus.PENDING_APPROVAL,
        description: 'Pending payment test',
      },
      select: { id: true },
    });
    for (const orphan of orphans) {
      await prisma.ledgerEntry.deleteMany({ where: { voucherId: orphan.id } });
      await prisma.voucher.delete({ where: { id: orphan.id } });
    }

    const before = await ledgerBalance(cashId);

    const voucher = await createVoucher({
      type: VoucherType.PAYMENT,
      debitAccountId: expenseId,
      creditAccountId: cashId,
      amount: 250,
      date: invoiceDate,
      description: 'Pending payment test',
      reference: `PEND-PAY-${Date.now()}`,
      createdById: userId,
      postImmediately: false,
    });

    expect(voucher.status).toBe(VoucherStatus.PENDING_APPROVAL);
    expect(await prisma.ledgerEntry.count({ where: { voucherId: voucher.id } })).toBe(0);
    expect(await ledgerBalance(cashId)).toBe(before);

    const pending = await listPendingApprovals();
    expect(pending.some((p) => p.kind === 'voucher' && p.id === voucher.id)).toBe(true);

    await approvePendingVoucher(voucher.id, adminId);
    expect(await ledgerBalance(cashId)).toBe(before - 250);

    const updated = await prisma.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(updated.status).toBe(VoucherStatus.ACTIVE);
  });

  it('USER sale invoice stays pending until ADMIN approves, then stock posts', async () => {
    await createPurchaseInvoice({
      invoiceDate,
      storeId,
      supplierAccountId: purchasePartyId,
      createdById: adminId,
      lines: [{ productId, quantity: 8, rate: 40 }],
    });

    const stockBefore = await getCurrentStockBalance(productId, storeId);

    const sale = await createSaleInvoice(
      {
        invoiceDate,
        storeId,
        customerAccountId: salePartyId,
        createdById: userId,
        lines: [{ productId, quantity: 3, rate: 100 }],
      },
      { postImmediately: false },
    );

    expect(sale.status).toBe(InvoiceStatus.PENDING_APPROVAL);
    expect(await getCurrentStockBalance(productId, storeId)).toBe(stockBefore);

    await approvePendingInvoice(sale.id);
    expect(await getCurrentStockBalance(productId, storeId)).toBe(stockBefore - 3);

    const posted = await prisma.invoice.findUniqueOrThrow({ where: { id: sale.id } });
    expect(posted.status).toBe(InvoiceStatus.POSTED);
  });
});
