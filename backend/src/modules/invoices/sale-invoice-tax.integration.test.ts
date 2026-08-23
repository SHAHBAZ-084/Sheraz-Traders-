import { AccountType, LedgerEntryType, VoucherType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { TAX_DEDUCTION_ACCOUNT_NAME } from '../accounting/accounting.service';
import { verifyLedgerIntegrity } from '../accounting/ledger-integrity';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { KACHI_MAAL_CATEGORY_NAMES } from '../accounting/accounting.service';
import { createProduct } from '../products/products.service';
import { createPurchaseInvoice } from './purchase-invoice.service';
import { createSaleInvoice } from './sale-invoice.service';
import { createStore } from '../stores/stores.service';

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

describe('Sale Invoice tax deduction', () => {
  let userId: number;
  let salePartyId: number;
  let purchasePartyId: number;
  let storeId: number;
  let productId: number;
  let invoiceDate: string;

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    salePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        'Sale Party Tax Test',
        AccountType.ASSET,
        `TAX-SALE-PARTY-${Date.now()}`,
      )
    ).id;

    purchasePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY,
        'Purchase Party Tax Test',
        AccountType.LIABILITY,
        `TAX-PURCHASE-PARTY-${Date.now()}`,
      )
    ).id;

    storeId = (await createStore(`Tax Test Store ${Date.now()}`)).id;
    const product = await createProduct({
      name: `Tax Test Product ${Date.now()}`,
      unit: 'bag',
      createdById: userId,
    });
    productId = product.id;

    await createPurchaseInvoice(
      {
        invoiceDate,
        storeId,
        supplierAccountId: purchasePartyId,
        createdById: userId,
        lines: [{ productId, quantity: 100, rate: 500 }],
      },
      { postImmediately: true },
    );
  });

  it('reduces party debit and debits Tax Deduction when tax is applied', async () => {
    const salePartyBefore = await prisma.ledger.findFirst({ where: { accountId: salePartyId } });

    const invoice = await createSaleInvoice(
      {
        invoiceDate,
        storeId,
        customerAccountId: salePartyId,
        createdById: userId,
        lines: [{ productId, quantity: 10, rate: 5700, taxAmount: 1000 }],
      },
      { postImmediately: true },
    );

    expect(Number(invoice.total)).toBe(57000);

    const taxAccount = await prisma.account.findFirst({
      where: { name: TAX_DEDUCTION_ACCOUNT_NAME, isActive: true },
    });
    expect(taxAccount).toBeTruthy();

    const voucherLink = await prisma.invoiceVoucher.findFirst({
      where: { invoiceId: invoice.id },
      include: {
        voucher: {
          include: {
            ledgerEntries: {
              include: { ledger: { include: { account: true } } },
            },
          },
        },
      },
    });
    expect(voucherLink?.voucher.type).toBe(VoucherType.SALE_INVOICE);

    const entries = voucherLink!.voucher.ledgerEntries;
    const partyDebit = entries.find(
      (e) => e.ledger.accountId === salePartyId && e.type === LedgerEntryType.DEBIT,
    );
    const taxDebit = entries.find(
      (e) => e.ledger.accountId === taxAccount!.id && e.type === LedgerEntryType.DEBIT,
    );

    expect(Number(partyDebit?.amount)).toBe(56000);
    expect(Number(taxDebit?.amount)).toBe(1000);

    const totalDebits = entries
      .filter((e) => e.type === LedgerEntryType.DEBIT)
      .reduce((sum, e) => sum + Number(e.amount), 0);
    const totalCredits = entries
      .filter((e) => e.type === LedgerEntryType.CREDIT)
      .reduce((sum, e) => sum + Number(e.amount), 0);
    expect(Math.abs(totalDebits - totalCredits)).toBeLessThan(0.02);

    const salePartyAfter = await prisma.ledger.findFirst({ where: { accountId: salePartyId } });
    const partyIncrease = Number(salePartyAfter!.balance) - Number(salePartyBefore!.balance);
    expect(partyIncrease).toBe(56000);

    await verifyLedgerIntegrity();
  });

  it('leaves posting unchanged when no tax is applied', async () => {
    const salePartyBefore = await prisma.ledger.findFirst({ where: { accountId: salePartyId } });

    await createSaleInvoice(
      {
        invoiceDate,
        storeId,
        customerAccountId: salePartyId,
        createdById: userId,
        lines: [{ productId, quantity: 1, rate: 1000 }],
      },
      { postImmediately: true },
    );

    const salePartyAfter = await prisma.ledger.findFirst({ where: { accountId: salePartyId } });
    expect(Number(salePartyAfter!.balance) - Number(salePartyBefore!.balance)).toBe(1000);

    const taxAccount = await prisma.account.findFirst({
      where: { name: TAX_DEDUCTION_ACCOUNT_NAME, isActive: true },
      include: { ledger: true },
    });
    expect(Number(taxAccount?.ledger?.balance ?? 0)).toBe(1000);
  });
});
