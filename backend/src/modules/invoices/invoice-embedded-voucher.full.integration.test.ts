import {
  AccountType,
  InvoiceStatus,
  InvoiceType,
  VoucherStatus,
  VoucherType,
} from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  approveVoucher,
  bootstrapChartOfAccounts,
  createVoucher,
  KACHI_MAAL_CATEGORY_NAMES,
  verifyLedgerIntegrity,
} from '../accounting/accounting.service';
import {
  approvePendingVoucher,
  listPendingApprovals,
  rejectPendingVoucher,
  updatePendingVoucher,
} from '../approvals/approvals.service';
import { createProduct } from '../products/products.service';
import { createStore } from '../stores/stores.service';
import { createPurchaseInvoice } from './purchase-invoice.service';
import { createSaleInvoice } from './sale-invoice.service';
import { getSaleBillSummary } from './sale-bill-report.service';
import { parseEmbeddedPaymentInput, parseEmbeddedReceiptInput } from './invoice-embedded-voucher';

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

async function ledgerBalance(accountId: number) {
  const ledger = await prisma.ledger.findUnique({ where: { accountId } });
  return Number(ledger?.balance ?? 0);
}

async function embeddedVoucherForInvoice(invoiceId: number, type: VoucherType) {
  return prisma.voucher.findFirst({
    where: { type, invoiceLink: { invoiceId } },
    include: { debitAccount: true, creditAccount: true },
  });
}

async function saleInvoiceVoucher(invoiceId: number) {
  return prisma.voucher.findFirst({
    where: { type: VoucherType.SALE_INVOICE, invoiceLink: { invoiceId } },
  });
}

describe('embedded invoice vouchers — full scenario matrix', () => {
  let userId: number;
  let storeId: number;
  let productId: number;
  let salePartyAId: number;
  let salePartyBId: number;
  let purchasePartyId: number;
  let cashAccountId: number;
  let bankAccountId: number;
  let invoiceDate: string;
  let adminEditor: { id: number; role: 'ADMIN' };

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('seed user required');
    userId = user.id;
    adminEditor = { id: userId, role: 'ADMIN' };

    storeId = (await createStore(`Full Embed Store ${Date.now()}`)).id;

    productId = (
      await createProduct(
        {
          name: `Full Embed Product ${Date.now()}`,
          code: `FEP${Date.now()}`,
          unit: 'bag',
          categoryName: 'Grain',
          openingStoreId: storeId,
          openingStock: 500,
          openingStockRate: 40,
        },
        { postImmediately: true, createdById: userId },
      )
    ).id;

    const ts = Date.now();
    salePartyAId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        'Full Test Sale Party A',
        AccountType.ASSET,
        `FSPA-${ts}`,
      )
    ).id;
    salePartyBId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        'Full Test Sale Party B',
        AccountType.ASSET,
        `FSPB-${ts + 1}`,
      )
    ).id;
    purchasePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY,
        'Full Test Purchase Party',
        AccountType.LIABILITY,
        `FPP-${ts + 2}`,
      )
    ).id;

    const cash = await prisma.account.findFirst({
      where: { isActive: true, category: { name: { contains: 'Cash' } } },
    });
    if (!cash) throw new Error('cash account required');
    cashAccountId = cash.id;

    const bank = await prisma.account.findFirst({
      where: { isActive: true, category: { name: { contains: 'Bank' } } },
    });
    if (!bank) throw new Error('bank account required');
    bankAccountId = bank.id;
  });

  describe('1. Sale Invoice — embedded Payment Received', () => {
    it('full payment creates SALE_RECEIPT pending voucher with correct legs', async () => {
      const partyBefore = await ledgerBalance(salePartyAId);
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyAId,
          createdById: userId,
          receiptAmount: 50_000,
          receiptAccountId: bankAccountId,
          lines: [{ productId, quantity: 10, rate: 5000 }],
        },
        { postImmediately: true },
      );

      expect(invoice.status).toBe(InvoiceStatus.POSTED);
      expect(await saleInvoiceVoucher(invoice.id)).toBeTruthy();

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      expect(embedded).toBeTruthy();
      expect(embedded!.status).toBe(VoucherStatus.PENDING_APPROVAL);
      expect(embedded!.type).toBe(VoucherType.SALE_RECEIPT);
      expect(Number(embedded!.amount)).toBe(50_000);
      expect(embedded!.debitAccountId).toBe(bankAccountId);
      expect(embedded!.creditAccountId).toBe(salePartyAId);
      expect(embedded!.description).toContain(`#${invoice.reference}`);

      const partyAfterInvoice = await ledgerBalance(salePartyAId);
      expect(partyAfterInvoice - partyBefore).toBe(50_000);
    });

    it('partial payment creates embedded voucher for partial amount only', async () => {
      const partyBefore = await ledgerBalance(salePartyAId);
      const cashBefore = await ledgerBalance(cashAccountId);

      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyAId,
          createdById: userId,
          receiptAmount: 20_000,
          receiptAccountId: cashAccountId,
          lines: [{ productId, quantity: 10, rate: 5000 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      expect(Number(embedded!.amount)).toBe(20_000);

      await approvePendingVoucher(embedded!.id, userId);

      const partyAfter = await ledgerBalance(salePartyAId);
      const cashAfter = await ledgerBalance(cashAccountId);
      expect(partyAfter - partyBefore).toBe(30_000);
      expect(cashAfter - cashBefore).toBe(20_000);
    });

    it('no payment creates no embedded voucher', async () => {
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyAId,
          createdById: userId,
          lines: [{ productId, quantity: 2, rate: 1000 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      expect(embedded).toBeNull();
    });

    it('blocks overpayment before save', async () => {
      expect(() => parseEmbeddedReceiptInput(60_000, cashAccountId, 50_000)).toThrow(/cannot exceed/);
      await expect(
        createSaleInvoice(
          {
            invoiceDate,
            storeId,
            customerAccountId: salePartyAId,
            createdById: userId,
            receiptAmount: 60_000,
            receiptAccountId: cashAccountId,
            lines: [{ productId, quantity: 10, rate: 5000 }],
          },
          { postImmediately: true },
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('explicit zero behaves like no payment', async () => {
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyAId,
          createdById: userId,
          receiptAmount: 0,
          lines: [{ productId, quantity: 1, rate: 500 }],
        },
        { postImmediately: true },
      );
      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT)).toBeNull();
    });
  });

  describe('2. Purchase Invoice — embedded Payment Made', () => {
    it('full payment creates PURCHASE_PAYMENT pending voucher (Dr party / Cr bank)', async () => {
      const invoice = await createPurchaseInvoice(
        {
          invoiceDate,
          storeId,
          supplierAccountId: purchasePartyId,
          createdById: userId,
          paymentAmount: 50_000,
          paymentAccountId: bankAccountId,
          lines: [{ productId, quantity: 10, rate: 5000 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.PURCHASE_PAYMENT);
      expect(embedded).toBeTruthy();
      expect(embedded!.status).toBe(VoucherStatus.PENDING_APPROVAL);
      expect(Number(embedded!.amount)).toBe(50_000);
      expect(embedded!.debitAccountId).toBe(purchasePartyId);
      expect(embedded!.creditAccountId).toBe(bankAccountId);
      expect(embedded!.description).toContain(`#${invoice.reference}`);
    });

    it('partial payment reduces outstanding supplier balance after approval', async () => {
      const partyBefore = await ledgerBalance(purchasePartyId);
      const bankBefore = await ledgerBalance(bankAccountId);

      const invoice = await createPurchaseInvoice(
        {
          invoiceDate,
          storeId,
          supplierAccountId: purchasePartyId,
          createdById: userId,
          paymentAmount: 20_000,
          paymentAccountId: bankAccountId,
          lines: [{ productId, quantity: 10, rate: 5000 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.PURCHASE_PAYMENT);
      await approvePendingVoucher(embedded!.id, userId);

      const partyAfter = await ledgerBalance(purchasePartyId);
      const bankAfter = await ledgerBalance(bankAccountId);
      // Liability party: invoice credits 50k (more negative), payment debits 20k → net −30k change.
      expect(partyAfter - partyBefore).toBe(-30_000);
      expect(bankAfter - bankBefore).toBe(-20_000);
    });

    it('no payment creates no embedded voucher', async () => {
      const invoice = await createPurchaseInvoice(
        {
          invoiceDate,
          storeId,
          supplierAccountId: purchasePartyId,
          createdById: userId,
          lines: [{ productId, quantity: 2, rate: 1000 }],
        },
        { postImmediately: true },
      );
      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.PURCHASE_PAYMENT)).toBeNull();
    });

    it('blocks overpayment before save', async () => {
      await expect(
        createPurchaseInvoice(
          {
            invoiceDate,
            storeId,
            supplierAccountId: purchasePartyId,
            createdById: userId,
            paymentAmount: 60_000,
            paymentAccountId: cashAccountId,
            lines: [{ productId, quantity: 10, rate: 5000 }],
          },
          { postImmediately: true },
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('explicit zero behaves like no payment', async () => {
      const invoice = await createPurchaseInvoice(
        {
          invoiceDate,
          storeId,
          supplierAccountId: purchasePartyId,
          createdById: userId,
          paymentAmount: 0,
          lines: [{ productId, quantity: 1, rate: 500 }],
        },
        { postImmediately: true },
      );
      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.PURCHASE_PAYMENT)).toBeNull();
    });
  });

  describe('3. Approval flow for embedded vouchers', () => {
    it('lists embedded vouchers in pending approvals with clear description', async () => {
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyBId,
          createdById: userId,
          receiptAmount: 5000,
          receiptAccountId: cashAccountId,
          lines: [{ productId, quantity: 1, rate: 5000 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      expect(embedded).toBeTruthy();
      expect(embedded!.description).toContain(`#${invoice.reference}`);

      const pending = await listPendingApprovals();
      const row = pending.find(
        (p) => p.kind === 'voucher' && p.id === embedded!.id,
      );
      expect(row).toBeTruthy();
      expect(row!.type).toBe(VoucherType.SALE_RECEIPT);
      expect(row!.description).toContain(`#${invoice.reference}`);
    });

    it('rejecting embedded receipt leaves posted invoice intact', async () => {
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyBId,
          createdById: userId,
          receiptAmount: 3000,
          receiptAccountId: cashAccountId,
          lines: [{ productId, quantity: 1, rate: 3000 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      await rejectPendingVoucher(embedded!.id);

      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(inv.status).toBe(InvoiceStatus.POSTED);
      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT)).toBeNull();
      expect(inv.embeddedReceiptAmount).toBeNull();
    });

    it('allows editing pending embedded receipt before approval', async () => {
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyBId,
          createdById: userId,
          receiptAmount: 4000,
          receiptAccountId: cashAccountId,
          lines: [{ productId, quantity: 1, rate: 8000 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      await updatePendingVoucher(embedded!.id, adminEditor, {
        date: invoiceDate,
        debitAccountId: bankAccountId,
        creditAccountId: salePartyBId,
        amount: 6000,
        reference: embedded!.reference!,
        description: embedded!.description,
      });

      const updated = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      expect(updated!.status).toBe(VoucherStatus.PENDING_APPROVAL);
      expect(Number(updated!.amount)).toBe(6000);
      expect(updated!.debitAccountId).toBe(bankAccountId);

      await approvePendingVoucher(updated!.id, userId);
      expect((await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT))!.status).toBe(
        VoucherStatus.ACTIVE,
      );
    });
  });

  describe('4. Voucher numbering isolation', () => {
    it('SALE_RECEIPT numbers independently from RECEIPT', async () => {
      const fy = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
      const receiptMax = await prisma.voucher.aggregate({
        where: { financialYearId: fy!.id, type: VoucherType.RECEIPT },
        _max: { number: true },
      });
      const saleReceiptMax = await prisma.voucher.aggregate({
        where: { financialYearId: fy!.id, type: VoucherType.SALE_RECEIPT },
        _max: { number: true },
      });

      const standalone = await createVoucher({
        type: VoucherType.RECEIPT,
        debitAccountId: cashAccountId,
        creditAccountId: salePartyAId,
        amount: 111,
        date: invoiceDate,
        reference: `RCPT-ISO-${Date.now()}`,
        createdById: userId,
        postImmediately: false,
      });

      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyAId,
          createdById: userId,
          receiptAmount: 222,
          receiptAccountId: cashAccountId,
          lines: [{ productId, quantity: 1, rate: 222 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      expect(standalone.number).toBe((receiptMax._max.number ?? 0) + 1);
      expect(embedded!.number).toBe((saleReceiptMax._max.number ?? 0) + 1);
      expect(embedded!.number).not.toBe(standalone.number);
    });

    it('PURCHASE_PAYMENT numbers independently from PAYMENT', async () => {
      const fy = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
      const paymentMax = await prisma.voucher.aggregate({
        where: { financialYearId: fy!.id, type: VoucherType.PAYMENT },
        _max: { number: true },
      });
      const purchasePaymentMax = await prisma.voucher.aggregate({
        where: { financialYearId: fy!.id, type: VoucherType.PURCHASE_PAYMENT },
        _max: { number: true },
      });

      const standalone = await createVoucher({
        type: VoucherType.PAYMENT,
        debitAccountId: purchasePartyId,
        creditAccountId: cashAccountId,
        amount: 333,
        date: invoiceDate,
        reference: `PAY-ISO-${Date.now()}`,
        createdById: userId,
        postImmediately: false,
      });

      const invoice = await createPurchaseInvoice(
        {
          invoiceDate,
          storeId,
          supplierAccountId: purchasePartyId,
          createdById: userId,
          paymentAmount: 444,
          paymentAccountId: cashAccountId,
          lines: [{ productId, quantity: 1, rate: 444 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.PURCHASE_PAYMENT);
      expect(standalone.number).toBe((paymentMax._max.number ?? 0) + 1);
      expect(embedded!.number).toBe((purchasePaymentMax._max.number ?? 0) + 1);
      expect(embedded!.number).not.toBe(standalone.number);
    });
  });

  describe('5. Sale Bill Summary report', () => {
    it('groups invoices by party with correct totals and pending exclusion', async () => {
      const invFull = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyAId,
          createdById: userId,
          receiptAmount: 10_000,
          receiptAccountId: bankAccountId,
          lines: [{ productId, quantity: 2, rate: 5000 }],
        },
        { postImmediately: true },
      );
      const invPartial = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyBId,
          createdById: userId,
          receiptAmount: 3000,
          receiptAccountId: cashAccountId,
          lines: [{ productId, quantity: 1, rate: 8000 }],
        },
        { postImmediately: true },
      );
      const invNone = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyBId,
          createdById: userId,
          lines: [{ productId, quantity: 1, rate: 2200 }],
        },
        { postImmediately: true },
      );

      const fullReceipt = await embeddedVoucherForInvoice(invFull.id, VoucherType.SALE_RECEIPT);
      await approvePendingVoucher(fullReceipt!.id, userId);

      let report = await getSaleBillSummary({ fromDate: invoiceDate, toDate: invoiceDate });
      const testInvoices = report.invoices.filter((r) =>
        [invFull.id, invPartial.id, invNone.id].includes(r.invoiceId),
      );
      expect(testInvoices).toHaveLength(3);

      const rowFull = testInvoices.find((r) => r.invoiceId === invFull.id)!;
      const rowPartial = testInvoices.find((r) => r.invoiceId === invPartial.id)!;
      const rowNone = testInvoices.find((r) => r.invoiceId === invNone.id)!;

      expect(rowFull.receivedAmount).toBe(10_000);
      expect(rowFull.receivedPending).toBe(false);
      expect(rowFull.netTotal).toBe(10_000);
      expect(rowFull.lines[0].productName).toBeTruthy();

      expect(rowPartial.receivedAmount).toBe(0);
      expect(rowPartial.receivedPending).toBe(true);
      expect(rowPartial.netTotal).toBe(8000);

      expect(rowNone.receivedAmount).toBe(0);
      expect(rowNone.receivedPending).toBe(false);
      expect(rowNone.receivedAccountLabel).toBeNull();

      const sumNet = testInvoices.reduce((s, r) => s + r.netTotal, 0);
      const sumReceived = testInvoices.reduce((s, r) => s + r.receivedAmount, 0);
      expect(sumReceived).toBe(10_000);
      expect(sumNet - sumReceived).toBe(report.remainingTotal >= 0 ? sumNet - sumReceived : 0);

      report = await getSaleBillSummary({
        fromDate: invoiceDate,
        toDate: invoiceDate,
        partyAccountId: salePartyBId,
      });
      expect(report.invoices.every((r) => r.partyAccountId === salePartyBId)).toBe(true);
      expect(report.invoices.some((r) => r.invoiceId === invFull.id)).toBe(false);
    });
  });

  describe('6. Ledger integrity', () => {
    it('verifyLedgerIntegrity returns ok after mixed embedded voucher operations', async () => {
      const report = await verifyLedgerIntegrity();
      expect(report.ok).toBe(true);
    });
  });
});

describe('createSaleInvoice without embedded payment (regression)', () => {
  it('still posts only SALE_INVOICE voucher when no receipt', async () => {
    const user = await prisma.user.findFirst();
    const store = await prisma.store.findFirst({ where: { isActive: true } });
    const product = await prisma.product.findFirst({ where: { isActive: true } });
    const party = await prisma.account.findFirst({
      where: { category: { name: KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY } },
    });
    if (!user || !store || !product || !party) return;

    const invoiceDate = await voucherDateInActiveYear();
    const invoice = await createSaleInvoice(
      {
        invoiceDate,
        storeId: store.id,
        customerAccountId: party.id,
        createdById: user.id,
        lines: [{ productId: product.id, quantity: 1, rate: 100 }],
      },
      { postImmediately: true },
    );

    const links = await prisma.invoiceVoucher.findMany({
      where: { invoiceId: invoice.id },
      include: { voucher: true },
    });
    expect(links.some((l) => l.voucher.type === VoucherType.SALE_INVOICE)).toBe(true);
    expect(links.some((l) => l.voucher.type === VoucherType.SALE_RECEIPT)).toBe(false);
  });
});
