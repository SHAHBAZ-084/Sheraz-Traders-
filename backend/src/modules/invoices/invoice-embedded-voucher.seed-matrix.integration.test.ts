/**
 * Embedded Receipt/Payment matrix using test-seed-data.json accounts/parties/products.
 * Prerequisite: npm run db:seed -w backend && npm run db:seed:test -w backend
 */
import {
  InvoiceStatus,
  VoucherStatus,
  VoucherType,
} from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  bootstrapChartOfAccounts,
  createVoucher,
  listAccounts,
  verifyLedgerIntegrity,
} from '../accounting/accounting.service';
import {
  approvePendingVoucher,
  listPendingApprovals,
  rejectPendingVoucher,
  updatePendingVoucher,
} from '../approvals/approvals.service';
import { createPurchaseInvoice } from './purchase-invoice.service';
import { createSaleInvoice } from './sale-invoice.service';

async function accountByName(name: string) {
  const { items: accounts } = await listAccounts();
  const account = accounts.find((a) => a.name === name);
  if (!account?.ledger) throw new Error(`Account not found: ${name}`);
  return account;
}

async function productByName(name: string) {
  const product = await prisma.product.findFirst({ where: { name, isActive: true } });
  if (!product) throw new Error(`Product not found: ${name}`);
  return product;
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

async function testSeedPresent() {
  const marker = await prisma.account.findFirst({
    where: { name: 'HBL Main Branch', isActive: true },
  });
  return marker != null;
}

const seedReady = await testSeedPresent();

describe.skipIf(!seedReady)('embedded invoice vouchers — test-seed matrix', () => {
  let userId: number;
  let storeId: number;
  let invoiceDate: string;
  let adminEditor: { id: number; role: 'ADMIN' };

  let hblId: number;
  let ublId: number;
  let cashId: number;
  let iqbalId: number;
  let malikId: number;
  let ahmadId: number;
  let waseemId: number;
  let ureaId: number;
  let dapId: number;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('seed user required');
    userId = user.id;
    adminEditor = { id: userId, role: 'ADMIN' };

    const store = await prisma.store.findFirst({ where: { name: 'Main Godown', isActive: true } });
    if (!store) throw new Error('Main Godown store required — run npm run db:seed:test -w backend');
    storeId = store.id;

    hblId = (await accountByName('HBL Main Branch')).id;
    ublId = (await accountByName('UBL Chishtian')).id;
    cashId = (await accountByName('Cash in Hand')).id;
    iqbalId = (await accountByName('Iqbal Farm House')).id;
    malikId = (await accountByName('Malik Brothers Agri Store')).id;
    ahmadId = (await accountByName('Ahmad Traders')).id;
    waseemId = (await accountByName('Waseem Grain Suppliers')).id;
    ureaId = (await productByName('Urea')).id;
    dapId = (await productByName('DAP')).id;
  });

  describe('sale invoice — embedded receipt', () => {
    it('full payment via bank creates SALE_RECEIPT pending voucher', async () => {
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: iqbalId,
          createdById: userId,
          receiptAmount: 45_500,
          receiptAccountId: hblId,
          lines: [{ productId: ureaId, quantity: 10, rate: 4550 }],
        },
        { postImmediately: true },
      );

      expect(invoice.status).toBe(InvoiceStatus.POSTED);
      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      expect(embedded).toBeTruthy();
      expect(embedded!.status).toBe(VoucherStatus.PENDING_APPROVAL);
      expect(Number(embedded!.amount)).toBe(45_500);
      expect(embedded!.debitAccountId).toBe(hblId);
      expect(embedded!.creditAccountId).toBe(iqbalId);
      expect(embedded!.description).toBe(`Receipt against Invoice #${invoice.reference}`);
    });

    it('partial payment via cash — outstanding reduces after approval', async () => {
      const partyBefore = await ledgerBalance(malikId);
      const cashBefore = await ledgerBalance(cashId);

      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: malikId,
          createdById: userId,
          receiptAmount: 20_000,
          receiptAccountId: cashId,
          lines: [{ productId: dapId, quantity: 5, rate: 12_500 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      expect(Number(embedded!.amount)).toBe(20_000);
      expect(embedded!.debitAccountId).toBe(cashId);
      expect(embedded!.creditAccountId).toBe(malikId);

      await approvePendingVoucher(embedded!.id, userId);

      const partyAfter = await ledgerBalance(malikId);
      const cashAfter = await ledgerBalance(cashId);
      expect(partyAfter - partyBefore).toBe(42_500);
      expect(cashAfter - cashBefore).toBe(20_000);
    });

    it('no payment creates no embedded voucher', async () => {
      const pendingBefore = (await listPendingApprovals()).filter(
        (p) => p.kind === 'voucher' && p.type === VoucherType.SALE_RECEIPT,
      ).length;

      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: iqbalId,
          createdById: userId,
          lines: [{ productId: ureaId, quantity: 8, rate: 4550 }],
        },
        { postImmediately: true },
      );

      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT)).toBeNull();

      const pendingAfter = (await listPendingApprovals()).filter(
        (p) => p.kind === 'voucher' && p.type === VoucherType.SALE_RECEIPT,
      ).length;
      expect(pendingAfter).toBe(pendingBefore);
    });

    it('zero amount without account behaves like no payment', async () => {
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: malikId,
          createdById: userId,
          receiptAmount: 0,
          lines: [{ productId: dapId, quantity: 2, rate: 12_500 }],
        },
        { postImmediately: true },
      );
      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT)).toBeNull();
    });

    it('blocks overpayment before save', async () => {
      await expect(
        createSaleInvoice(
          {
            invoiceDate,
            storeId,
            customerAccountId: iqbalId,
            createdById: userId,
            receiptAmount: 60_000,
            receiptAccountId: hblId,
            lines: [{ productId: ureaId, quantity: 10, rate: 4550 }],
          },
          { postImmediately: true },
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Receipt amount cannot exceed invoice total',
      });
    });

    it('blocks account selected with zero amount', async () => {
      await expect(
        createSaleInvoice(
          {
            invoiceDate,
            storeId,
            customerAccountId: malikId,
            createdById: userId,
            receiptAmount: 0,
            receiptAccountId: ublId,
            lines: [{ productId: dapId, quantity: 3, rate: 12_500 }],
          },
          { postImmediately: true },
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Receipt amount is required when a receipt account is selected',
      });
    });

    it('blocks amount without account selected', async () => {
      await expect(
        createSaleInvoice(
          {
            invoiceDate,
            storeId,
            customerAccountId: iqbalId,
            createdById: userId,
            receiptAmount: 10_000,
            lines: [{ productId: ureaId, quantity: 5, rate: 4550 }],
          },
          { postImmediately: true },
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Receipt account is required when receipt amount is greater than zero',
      });
    });
  });

  describe('purchase invoice — embedded payment', () => {
    it('full payment via bank creates PURCHASE_PAYMENT pending voucher', async () => {
      const invoice = await createPurchaseInvoice(
        {
          invoiceDate,
          storeId,
          supplierAccountId: ahmadId,
          createdById: userId,
          paymentAmount: 84_000,
          paymentAccountId: hblId,
          lines: [{ productId: ureaId, quantity: 20, rate: 4200 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.PURCHASE_PAYMENT);
      expect(embedded).toBeTruthy();
      expect(embedded!.status).toBe(VoucherStatus.PENDING_APPROVAL);
      expect(Number(embedded!.amount)).toBe(84_000);
      expect(embedded!.debitAccountId).toBe(ahmadId);
      expect(embedded!.creditAccountId).toBe(hblId);
      expect(embedded!.description).toBe(`Payment against Invoice #${invoice.reference}`);
    });

    it('partial payment via cash — remaining payable after approval', async () => {
      const partyBefore = await ledgerBalance(waseemId);
      const cashBefore = await ledgerBalance(cashId);

      const invoice = await createPurchaseInvoice(
        {
          invoiceDate,
          storeId,
          supplierAccountId: waseemId,
          createdById: userId,
          paymentAmount: 50_000,
          paymentAccountId: cashId,
          lines: [{ productId: dapId, quantity: 10, rate: 11_500 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.PURCHASE_PAYMENT);
      await approvePendingVoucher(embedded!.id, userId);

      const partyAfter = await ledgerBalance(waseemId);
      const cashAfter = await ledgerBalance(cashId);
      expect(partyAfter - partyBefore).toBe(-65_000);
      expect(cashAfter - cashBefore).toBe(-50_000);
    });

    it('no payment creates no embedded voucher', async () => {
      const invoice = await createPurchaseInvoice(
        {
          invoiceDate,
          storeId,
          supplierAccountId: ahmadId,
          createdById: userId,
          lines: [{ productId: ureaId, quantity: 15, rate: 4200 }],
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
            supplierAccountId: waseemId,
            createdById: userId,
            paymentAmount: 70_000,
            paymentAccountId: ublId,
            lines: [{ productId: dapId, quantity: 5, rate: 11_500 }],
          },
          { postImmediately: true },
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Payment amount cannot exceed invoice total',
      });
    });
  });

  describe('voucher numbering isolation', () => {
    it('SALE_RECEIPT does not advance RECEIPT sequence', async () => {
      const fy = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
      const receiptMax = await prisma.voucher.aggregate({
        where: { financialYearId: fy!.id, type: VoucherType.RECEIPT },
        _max: { number: true },
      });

      const standalone1 = await createVoucher({
        type: VoucherType.RECEIPT,
        debitAccountId: cashId,
        creditAccountId: iqbalId,
        amount: 100,
        date: invoiceDate,
        reference: `RCPT-SEED-ISO-${Date.now()}-1`,
        createdById: userId,
        postImmediately: false,
      });
      expect(standalone1.number).toBe((receiptMax._max.number ?? 0) + 1);

      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: iqbalId,
          createdById: userId,
          receiptAmount: 200,
          receiptAccountId: cashId,
          lines: [{ productId: ureaId, quantity: 1, rate: 200 }],
        },
        { postImmediately: true },
      );
      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      expect(embedded!.number).not.toBe(standalone1.number);

      const standalone2 = await createVoucher({
        type: VoucherType.RECEIPT,
        debitAccountId: cashId,
        creditAccountId: iqbalId,
        amount: 101,
        date: invoiceDate,
        reference: `RCPT-SEED-ISO-${Date.now()}-2`,
        createdById: userId,
        postImmediately: false,
      });
      expect(standalone2.number).toBe(standalone1.number + 1);
    });

    it('PURCHASE_PAYMENT does not advance PAYMENT sequence', async () => {
      const fy = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
      const paymentMax = await prisma.voucher.aggregate({
        where: { financialYearId: fy!.id, type: VoucherType.PAYMENT },
        _max: { number: true },
      });

      const standalone1 = await createVoucher({
        type: VoucherType.PAYMENT,
        debitAccountId: ahmadId,
        creditAccountId: cashId,
        amount: 100,
        date: invoiceDate,
        reference: `PAY-SEED-ISO-${Date.now()}-1`,
        createdById: userId,
        postImmediately: false,
      });
      expect(standalone1.number).toBe((paymentMax._max.number ?? 0) + 1);

      const invoice = await createPurchaseInvoice(
        {
          invoiceDate,
          storeId,
          supplierAccountId: ahmadId,
          createdById: userId,
          paymentAmount: 200,
          paymentAccountId: cashId,
          lines: [{ productId: ureaId, quantity: 1, rate: 200 }],
        },
        { postImmediately: true },
      );
      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.PURCHASE_PAYMENT);
      expect(embedded!.number).not.toBe(standalone1.number);

      const standalone2 = await createVoucher({
        type: VoucherType.PAYMENT,
        debitAccountId: ahmadId,
        creditAccountId: cashId,
        amount: 101,
        date: invoiceDate,
        reference: `PAY-SEED-ISO-${Date.now()}-2`,
        createdById: userId,
        postImmediately: false,
      });
      expect(standalone2.number).toBe(standalone1.number + 1);
    });
  });

  describe('approval flow', () => {
    it('lists embedded receipt in pending approvals with invoice reference', async () => {
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: malikId,
          createdById: userId,
          receiptAmount: 20_000,
          receiptAccountId: cashId,
          lines: [{ productId: dapId, quantity: 5, rate: 12_500 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      const pending = await listPendingApprovals();
      const row = pending.find((p) => p.kind === 'voucher' && p.id === embedded!.id);
      expect(row).toBeTruthy();
      expect(row!.type).toBe(VoucherType.SALE_RECEIPT);
      expect(row!.description).toContain(`Receipt against Invoice #${invoice.reference}`);
    });

    it('allows editing pending embedded receipt; still requires approval', async () => {
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: malikId,
          createdById: userId,
          receiptAmount: 20_000,
          receiptAccountId: cashId,
          lines: [{ productId: dapId, quantity: 5, rate: 12_500 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      await updatePendingVoucher(embedded!.id, adminEditor, {
        date: invoiceDate,
        debitAccountId: hblId,
        creditAccountId: malikId,
        amount: 25_000,
        reference: embedded!.reference!,
        description: embedded!.description,
      });

      const updated = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      expect(updated!.status).toBe(VoucherStatus.PENDING_APPROVAL);
      expect(Number(updated!.amount)).toBe(25_000);
      expect(updated!.debitAccountId).toBe(hblId);
    });

    it('rejecting embedded receipt leaves posted invoice intact', async () => {
      const invoice = await createSaleInvoice(
        {
          invoiceDate,
          storeId,
          customerAccountId: iqbalId,
          createdById: userId,
          receiptAmount: 5000,
          receiptAccountId: cashId,
          lines: [{ productId: ureaId, quantity: 2, rate: 4550 }],
        },
        { postImmediately: true },
      );

      const embedded = await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT);
      await rejectPendingVoucher(embedded!.id);

      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(inv.status).toBe(InvoiceStatus.POSTED);
      expect(await embeddedVoucherForInvoice(invoice.id, VoucherType.SALE_RECEIPT)).toBeNull();
    });
  });

  describe('ledger integrity', () => {
    it('verifyLedgerIntegrity returns ok after full matrix', async () => {
      const report = await verifyLedgerIntegrity();
      expect(report.ok).toBe(true);
    });
  });
});

describe('embedded invoice vouchers — test-seed prerequisite', () => {
  it('documents skip when test-seed is not loaded', () => {
    if (!seedReady) {
      console.warn(
        'Skipped seed-matrix tests — run: npm run db:seed -w backend && npm run db:seed:test -w backend',
      );
    }
    expect(true).toBe(true);
  });
});
