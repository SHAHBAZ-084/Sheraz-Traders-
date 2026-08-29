import {
  AccountType,
  InvoiceStatus,
  VoucherType,
} from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  bootstrapChartOfAccounts,
  KACHI_MAAL_CATEGORY_NAMES,
  verifyLedgerIntegrity,
} from '../accounting/accounting.service';
import {
  listPendingApprovals,
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

async function embeddedVouchersForInvoice(invoiceId: number, type: VoucherType) {
  return prisma.voucher.findMany({
    where: { type, invoiceLink: { invoiceId } },
    include: { debitAccount: true, creditAccount: true },
    orderBy: { id: 'asc' },
  });
}

async function saleInvoiceVoucher(invoiceId: number) {
  return prisma.voucher.findFirst({
    where: { type: VoucherType.SALE_INVOICE, invoiceLink: { invoiceId } },
  });
}

async function invoiceVoucherLegs(invoiceId: number, type: VoucherType) {
  const voucher = await prisma.voucher.findFirst({
    where: { type, invoiceLink: { invoiceId } },
    include: {
      ledgerEntries: {
        where: { isReversal: false },
        orderBy: { id: 'asc' },
        include: { ledger: { include: { account: true } } },
      },
    },
  });
  if (!voucher) return [];
  return voucher.ledgerEntries.map((e) => ({
    accountId: e.ledger.accountId,
    type: e.type,
    amount: Number(e.amount),
    notes: e.notes ?? '',
  }));
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

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('seed user required');
    userId = user.id;

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
    it('full payment folds receipt legs into SALE_INVOICE (no separate SALE_RECEIPT)', async () => {
      const partyBefore = await ledgerBalance(salePartyAId);
      const bankBefore = await ledgerBalance(bankAccountId);
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
      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT)).toBeNull();

      const legs = await invoiceVoucherLegs(invoice.id, VoucherType.SALE_INVOICE);
      const receiptLegs = legs.filter((l) => l.notes.includes(`Receipt against Invoice #${invoice.reference}`));
      expect(receiptLegs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: bankAccountId, type: 'DEBIT', amount: 50_000 }),
          expect.objectContaining({ accountId: salePartyAId, type: 'CREDIT', amount: 50_000 }),
        ]),
      );

      // Full payment: party debited 50k then credited 50k → net 0; bank +50k.
      expect(await ledgerBalance(salePartyAId) - partyBefore).toBe(0);
      expect(await ledgerBalance(bankAccountId) - bankBefore).toBe(50_000);
    });

    it('partial payment nets party to remaining outstanding', async () => {
      const partyBefore = await ledgerBalance(salePartyAId);
      const cashBefore = await ledgerBalance(cashAccountId);

      await createSaleInvoice(
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

      expect(await ledgerBalance(salePartyAId) - partyBefore).toBe(30_000);
      expect(await ledgerBalance(cashAccountId) - cashBefore).toBe(20_000);
    });

    it('multiple receipt lines fold into one SALE_INVOICE with distinguishable leg notes', async () => {
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: salePartyAId,
          createdById: userId,
          receipts: [
            { amount: 20_000, accountId: cashAccountId },
            { amount: 25_000, accountId: bankAccountId },
          ],
          lines: [{ productId, quantity: 10, rate: 5000 }],
        },
        { postImmediately: true },
      );

      expect(await embeddedVouchersForInvoice(invoice.id, VoucherType.SALE_RECEIPT)).toHaveLength(0);
      const legs = await invoiceVoucherLegs(invoice.id, VoucherType.SALE_INVOICE);
      const receiptNotes = legs.filter((l) => l.notes.includes('Receipt against Invoice'));
      expect(receiptNotes).toHaveLength(4); // Dr+Cr per line
      expect(receiptNotes.some((l) => l.notes.includes('Cash') || l.accountId === cashAccountId)).toBe(true);
      expect(receiptNotes.some((l) => l.accountId === bankAccountId)).toBe(true);
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
    it('full payment folds payment legs into PURCHASE_INVOICE (no separate PURCHASE_PAYMENT)', async () => {
      const partyBefore = await ledgerBalance(purchasePartyId);
      const bankBefore = await ledgerBalance(bankAccountId);
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

      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.PURCHASE_PAYMENT)).toBeNull();
      const legs = await invoiceVoucherLegs(invoice.id, VoucherType.PURCHASE_INVOICE);
      const paymentLegs = legs.filter((l) => l.notes.includes(`Payment against Invoice #${invoice.reference}`));
      expect(paymentLegs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: purchasePartyId, type: 'DEBIT', amount: 50_000 }),
          expect.objectContaining({ accountId: bankAccountId, type: 'CREDIT', amount: 50_000 }),
        ]),
      );
      // Full payment: Cr 50k then Dr 50k → net 0; bank −50k.
      expect(await ledgerBalance(purchasePartyId) - partyBefore).toBe(0);
      expect(await ledgerBalance(bankAccountId) - bankBefore).toBe(-50_000);
    });

    it('partial payment reduces outstanding supplier balance', async () => {
      const partyBefore = await ledgerBalance(purchasePartyId);
      const bankBefore = await ledgerBalance(bankAccountId);

      await createPurchaseInvoice(
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

      // Liability party: invoice credits 50k, payment debits 20k → net −30k.
      expect(await ledgerBalance(purchasePartyId) - partyBefore).toBe(-30_000);
      expect(await ledgerBalance(bankAccountId) - bankBefore).toBe(-20_000);
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

  describe('3. Pending approval — one item for invoice + payment', () => {
    it('pending sale with receipt shows one invoice item (not a SALE_RECEIPT voucher)', async () => {
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
        { postImmediately: false },
      );

      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT)).toBeNull();
      const pending = await listPendingApprovals();
      const invoiceRows = pending.filter((p) => p.kind === 'invoice' && p.id === invoice.id);
      expect(invoiceRows).toHaveLength(1);
      expect(invoiceRows[0].description).toMatch(/Received/i);
      expect(
        pending.some(
          (p) =>
            p.kind === 'voucher'
            && p.type === VoucherType.SALE_RECEIPT
            && (p.reference === `SR-${invoice.reference}` || p.description?.includes(`#${invoice.reference}`)),
        ),
      ).toBe(false);
    });

    it('rejecting pending invoice removes invoice and payment together', async () => {
      const { rejectPendingInvoice } = await import('../approvals/approvals.service');
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
        { postImmediately: false },
      );

      await rejectPendingInvoice(invoice.id);
      expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).toBeNull();
      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT)).toBeNull();
    });

    it('editing pending invoice receipt lines stays as one pending invoice', async () => {
      const { updatePendingSaleInvoice } = await import('./sale-invoice.service');
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
        { postImmediately: false },
      );

      await updatePendingSaleInvoice(invoice.id, {
        invoiceDate,
        storeId,
        customerAccountId: salePartyBId,
        receiptAmount: 6000,
        receiptAccountId: bankAccountId,
        lines: [{ productId, quantity: 1, rate: 8000 }],
      });

      const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(updated.status).toBe(InvoiceStatus.PENDING_APPROVAL);
      expect(Number(updated.embeddedReceiptAmount)).toBe(6000);
      expect(updated.embeddedReceiptAccountId).toBe(bankAccountId);
      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT)).toBeNull();
    });
  });

  describe('4. Voucher numbering isolation', () => {
    it('creating invoice with receipt does not create SALE_RECEIPT numbers', async () => {
      const fy = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
      const saleReceiptMaxBefore = await prisma.voucher.aggregate({
        where: { financialYearId: fy!.id, type: VoucherType.SALE_RECEIPT },
        _max: { number: true },
      });

      await createSaleInvoice(
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

      const saleReceiptMaxAfter = await prisma.voucher.aggregate({
        where: { financialYearId: fy!.id, type: VoucherType.SALE_RECEIPT },
        _max: { number: true },
      });
      expect(saleReceiptMaxAfter._max.number ?? 0).toBe(saleReceiptMaxBefore._max.number ?? 0);
    });

    it('creating purchase with payment does not create PURCHASE_PAYMENT numbers', async () => {
      const fy = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
      const before = await prisma.voucher.aggregate({
        where: { financialYearId: fy!.id, type: VoucherType.PURCHASE_PAYMENT },
        _max: { number: true },
      });

      await createPurchaseInvoice(
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

      const after = await prisma.voucher.aggregate({
        where: { financialYearId: fy!.id, type: VoucherType.PURCHASE_PAYMENT },
        _max: { number: true },
      });
      expect(after._max.number ?? 0).toBe(before._max.number ?? 0);
    });
  });

  describe('5. Sale Bill Summary report', () => {
    it('groups invoices by party with correct totals from embedded receipt scalars', async () => {
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

      // Posted invoices with folded receipts count as received (not pending).
      expect(rowPartial.receivedAmount).toBe(3000);
      expect(rowPartial.receivedPending).toBe(false);
      expect(rowPartial.netTotal).toBe(8000);

      expect(rowNone.receivedAmount).toBe(0);
      expect(rowNone.receivedPending).toBe(false);
      expect(rowNone.receivedAccountLabel).toBeNull();

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
