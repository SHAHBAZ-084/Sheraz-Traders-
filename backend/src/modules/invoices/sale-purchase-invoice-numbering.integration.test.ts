import { AccountType, VoucherType } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  KACHI_MAAL_CATEGORY_NAMES,
  previewNextVoucherNumber,
} from '../accounting/accounting.service';
import { createProduct } from '../products/products.service';
import { createStore } from '../stores/stores.service';
import { createPurchaseInvoice } from './purchase-invoice.service';
import { createSaleInvoice } from './sale-invoice.service';

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

async function nextNumberForType(financialYearId: number, type: VoucherType) {
  const { _max } = await prisma.voucher.aggregate({
    where: { financialYearId, type },
    _max: { number: true },
  });
  return (_max.number ?? 0) + 1;
}

describe('Sale/Purchase Invoice voucher numbering isolation', () => {
  let userId: number;
  let salePartyId: number;
  let purchasePartyId: number;
  let productId: number;
  let storeId: number;
  let invoiceDate: string;
  let financialYearId: number;

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    const fy = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
    if (!fy) throw new Error('No active financial year');
    financialYearId = fy.id;

    salePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        'Sale Party SI Number Test',
        AccountType.ASSET,
        'SI-PARTY-NUM',
      )
    ).id;

    purchasePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE,
        'Purchase Party PI Number Test',
        AccountType.LIABILITY,
        'PI-PARTY-NUM',
      )
    ).id;

    const product = await createProduct({ name: `SI/PI Number Product ${Date.now()}` });
    productId = product.id;

    const store = await createStore(`SI/PI Number Store ${Date.now()}`);
    storeId = store.id;
  });

  it('does not advance Journal sequence when posting SALE_INVOICE and PURCHASE_INVOICE', async () => {
    const journalBeforePreview = await previewNextVoucherNumber(VoucherType.JOURNAL);
    const journalBefore = await nextNumberForType(financialYearId, VoucherType.JOURNAL);
    expect(journalBeforePreview.number).toBe(journalBefore);

    const saleBefore = await nextNumberForType(financialYearId, VoucherType.SALE_INVOICE);
    const purchaseBefore = await nextNumberForType(financialYearId, VoucherType.PURCHASE_INVOICE);

    const purchaseInvoice = await createPurchaseInvoice({
      invoiceDate,
      storeId,
      supplierAccountId: purchasePartyId,
      billNo: 'PI-NUM-1',
      createdById: userId,
      lines: [{ productId, quantity: 3, rate: 50 }],
    });

    const saleInvoice = await createSaleInvoice({
      invoiceDate,
      storeId,
      customerAccountId: salePartyId,
      billNo: 'SI-NUM-1',
      createdById: userId,
      lines: [{ productId, quantity: 2, rate: 100 }],
    });

    const saleLinks = await prisma.invoiceVoucher.findMany({
      where: { invoiceId: saleInvoice.id },
      include: { voucher: true },
    });
    const purchaseLinks = await prisma.invoiceVoucher.findMany({
      where: { invoiceId: purchaseInvoice.id },
      include: { voucher: true },
    });

    expect(saleLinks).toHaveLength(1);
    expect(purchaseLinks).toHaveLength(1);

    const saleVoucher = saleLinks[0]!.voucher;
    const purchaseVoucher = purchaseLinks[0]!.voucher;

    expect(saleVoucher.type).toBe(VoucherType.SALE_INVOICE);
    expect(saleVoucher.type).not.toBe(VoucherType.JOURNAL);
    expect(saleVoucher.number).toBe(saleBefore);

    expect(purchaseVoucher.type).toBe(VoucherType.PURCHASE_INVOICE);
    expect(purchaseVoucher.type).not.toBe(VoucherType.JOURNAL);
    expect(purchaseVoucher.number).toBe(purchaseBefore);

    const journalAfterPreview = await previewNextVoucherNumber(VoucherType.JOURNAL);
    const journalAfter = await nextNumberForType(financialYearId, VoucherType.JOURNAL);
    expect(journalAfter).toBe(journalBefore);
    expect(journalAfterPreview.number).toBe(journalBeforePreview.number);

    const journalWithInvoiceRefs = await prisma.voucher.findMany({
      where: {
        financialYearId,
        type: VoucherType.JOURNAL,
        OR: [
          { description: { contains: saleInvoice.reference } },
          { description: { contains: purchaseInvoice.reference } },
          { reference: { contains: 'SI-NUM-1' } },
          { reference: { contains: 'PI-NUM-1' } },
        ],
      },
    });
    expect(journalWithInvoiceRefs).toHaveLength(0);
  });
});
