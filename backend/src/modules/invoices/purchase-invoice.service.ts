import {
  InvoiceStatus,
  InvoiceType,
  LedgerEntryType,
  Prisma,
  VoucherType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  assertPartyAccount,
  assertActiveFinancialYear,
  assertVoucherDateInActiveFinancialYear,
  createMultiLegVoucherInTx,
  ensurePurchaseMazduriAccount,
  getActiveFinancialYearId,
  WRITE_TRANSACTION_OPTIONS,
  type VoucherLeg,
} from '../accounting/accounting.service';
import { parseVoucherDateInput } from '../accounting/ledger-utils';
import { resolveMaalKhataAccountForProduct } from '../products/maal-khata';
import { assertActiveStore } from '../stores/stores.service';
import { postPurchaseInvoiceStockIn } from '../stock/stock.service';
import { voucherReferenceFromBillNo, formatInvoiceProductLinesDescription } from './invoice-voucher-descriptions';
import { nextInvoiceReferenceInTx } from './invoice-reference';
import {
  computePurchaseInvoiceTotals,
  roundMoney,
  type PurchaseInvoiceLineInput,
} from './purchase-invoice.calculations';

export async function getNextPurchaseInvoiceReference() {
  return prisma.$transaction(async (tx) => {
    const financialYearId = await getActiveFinancialYearId(tx);
    return nextInvoiceReferenceInTx(tx, InvoiceType.PURCHASE_INVOICE, financialYearId);
  });
}

export type CreatePurchaseInvoiceInput = {
  invoiceDate: string;
  billNo?: string;
  notes?: string;
  storeId: number;
  supplierAccountId: number;
  createdById: number;
  lines: PurchaseInvoiceLineInput[];
};

type ResolvedPurchaseLine = {
  productId: number;
  productName: string;
  maalKhataAccountId: number;
  quantity: number;
  rate: number;
  goodsTotal: number;
  mazduriAmount: number;
  /** Product debit = goods + mazduri. */
  lineTotal: number;
};

async function assertPurchasePartyAccount(tx: Prisma.TransactionClient, accountId: number) {
  return assertPartyAccount(tx, accountId, 'Supplier');
}

function buildPurchaseInvoiceLegs(
  supplierAccountId: number,
  resolvedLines: ResolvedPurchaseLine[],
  purchaseMazduriAccountId: number | null,
): { legs: VoucherLeg[]; productDescription: string; voucherAmount: number } {
  const productDescription = formatInvoiceProductLinesDescription(
    resolvedLines.map((line) => ({
      productName: line.productName,
      quantity: line.quantity,
      rate: line.rate,
    })),
  );

  const goodsTotal = roundMoney(resolvedLines.reduce((sum, line) => sum + line.goodsTotal, 0));
  const mazduriTotal = roundMoney(resolvedLines.reduce((sum, line) => sum + line.mazduriAmount, 0));
  const voucherAmount = roundMoney(goodsTotal + mazduriTotal);

  const legs: VoucherLeg[] = [
    ...resolvedLines.map((line) => ({
      accountId: line.maalKhataAccountId,
      type: LedgerEntryType.DEBIT,
      amount: line.lineTotal,
      description: productDescription,
      mazduriAmount: line.mazduriAmount > 0 ? line.mazduriAmount : null,
    })),
    {
      accountId: supplierAccountId,
      type: LedgerEntryType.CREDIT,
      amount: goodsTotal,
      description: productDescription,
    },
  ];

  if (mazduriTotal > 0) {
    if (purchaseMazduriAccountId == null) {
      throw new AppError(500, 'Purchase Mazduri account is required when Mazduri is present');
    }
    legs.push({
      accountId: purchaseMazduriAccountId,
      type: LedgerEntryType.CREDIT,
      amount: mazduriTotal,
      description: productDescription,
    });
  }

  const totalDebits = roundMoney(
    legs.filter((l) => l.type === LedgerEntryType.DEBIT).reduce((s, l) => s + l.amount, 0),
  );
  const totalCredits = roundMoney(
    legs.filter((l) => l.type === LedgerEntryType.CREDIT).reduce((s, l) => s + l.amount, 0),
  );
  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new AppError(500, 'Purchase Invoice voucher debits and credits do not balance');
  }
  return { legs, productDescription, voucherAmount };
}

async function postPurchaseInvoiceAccounting(
  tx: Prisma.TransactionClient,
  invoice: {
    id: number;
    reference: string;
    invoiceDate: Date;
    billNo: string | null;
    storeId: number;
    debitAccountId: number;
    createdById: number;
  },
  resolvedLines: ResolvedPurchaseLine[],
) {
  const mazduriTotal = roundMoney(resolvedLines.reduce((sum, line) => sum + line.mazduriAmount, 0));
  const purchaseMazduri =
    mazduriTotal > 0 ? await ensurePurchaseMazduriAccount(tx) : null;

  const { legs, productDescription, voucherAmount } = buildPurchaseInvoiceLegs(
    invoice.debitAccountId,
    resolvedLines,
    purchaseMazduri?.id ?? null,
  );

  const voucher = await createMultiLegVoucherInTx(tx, {
    type: VoucherType.PURCHASE_INVOICE,
    legs,
    amount: voucherAmount,
    date: invoice.invoiceDate,
    description: productDescription,
    reference: voucherReferenceFromBillNo(invoice.billNo ?? undefined),
    createdById: invoice.createdById,
  });

  await tx.invoiceVoucher.create({
    data: { invoiceId: invoice.id, voucherId: voucher.id },
  });

  await postPurchaseInvoiceStockIn(tx, {
    invoiceId: invoice.id,
    invoiceReference: invoice.reference,
    invoiceDate: invoice.invoiceDate,
    storeId: invoice.storeId,
    lines: resolvedLines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
    })),
  });
}

export async function createPurchaseInvoice(
  data: CreatePurchaseInvoiceInput,
  opts?: { postImmediately?: boolean },
) {
  const postImmediately = opts?.postImmediately !== false;
  let totals;
  try {
    totals = computePurchaseInvoiceTotals(data.lines);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : 'Invalid purchase invoice lines');
  }

  return prisma.$transaction(async (tx) => {
    let invoiceDate: Date;
    try {
      invoiceDate = parseVoucherDateInput(data.invoiceDate);
    } catch {
      throw new AppError(400, 'Invalid invoice date');
    }
    const financialYearId = await assertVoucherDateInActiveFinancialYear(tx, invoiceDate, 'Invoice');

    await assertActiveStore(data.storeId, tx);
    await assertPurchasePartyAccount(tx, data.supplierAccountId);

    const resolvedLines: ResolvedPurchaseLine[] = [];

    for (const line of totals.lines) {
      const { product, maalKhataAccountId } = await resolveMaalKhataAccountForProduct(tx, line.productId);
      resolvedLines.push({
        productId: product.id,
        productName: product.name,
        maalKhataAccountId,
        quantity: line.quantity,
        rate: line.rate,
        goodsTotal: line.goodsTotal,
        mazduriAmount: line.mazduriAmount,
        lineTotal: line.lineTotal,
      });
    }

    if (totals.mazduriTotal > 0) {
      await ensurePurchaseMazduriAccount(tx);
    }
    buildPurchaseInvoiceLegs(
      data.supplierAccountId,
      resolvedLines,
      totals.mazduriTotal > 0
        ? (await ensurePurchaseMazduriAccount(tx)).id
        : null,
    );

    const reference = await nextInvoiceReferenceInTx(tx, InvoiceType.PURCHASE_INVOICE, financialYearId);

    const invoice = await tx.invoice.create({
      data: {
        type: InvoiceType.PURCHASE_INVOICE,
        status: postImmediately ? InvoiceStatus.POSTED : InvoiceStatus.PENDING_APPROVAL,
        reference,
        invoiceDate,
        billNo: data.billNo?.trim() || null,
        notes: data.notes?.trim() || null,
        storeId: data.storeId,
        debitAccountId: data.supplierAccountId,
        total: totals.invoiceTotal,
        financialYearId,
        createdById: data.createdById,
        items: {
          create: resolvedLines.map((line) => ({
            productId: line.productId,
            label: line.productName,
            quantity: line.quantity,
            unitPrice: line.rate,
            total: line.goodsTotal,
            mazduriAmount: line.mazduriAmount,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });

    if (postImmediately) {
      await postPurchaseInvoiceAccounting(
        tx,
        {
          id: invoice.id,
          reference,
          invoiceDate,
          billNo: invoice.billNo,
          storeId: data.storeId,
          debitAccountId: data.supplierAccountId,
          createdById: data.createdById,
        },
        resolvedLines,
      );
    }

    return invoice;
  }, WRITE_TRANSACTION_OPTIONS);
}

export async function approvePurchaseInvoice(invoiceId: number) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: {
        id: invoiceId,
        type: InvoiceType.PURCHASE_INVOICE,
        status: InvoiceStatus.PENDING_APPROVAL,
      },
      include: { items: { include: { product: true } } },
    });
    if (!invoice) throw new AppError(404, 'Pending purchase invoice not found');
    await assertActiveFinancialYear(tx, invoice.financialYearId);
    if (invoice.storeId == null) throw new AppError(400, 'Purchase invoice missing store');
    if (invoice.debitAccountId == null) throw new AppError(400, 'Purchase invoice missing supplier');

    await assertActiveStore(invoice.storeId, tx);
    await assertPurchasePartyAccount(tx, invoice.debitAccountId);

    const resolvedLines: ResolvedPurchaseLine[] = [];
    for (const item of invoice.items) {
      if (item.productId == null) throw new AppError(400, 'Purchase invoice line missing product');
      const { product, maalKhataAccountId } = await resolveMaalKhataAccountForProduct(tx, item.productId);
      const goodsTotal = Number(item.total);
      const mazduriAmount = Number(item.mazduriAmount ?? 0);
      resolvedLines.push({
        productId: product.id,
        productName: product.name,
        maalKhataAccountId,
        quantity: Number(item.quantity),
        rate: Number(item.unitPrice),
        goodsTotal,
        mazduriAmount,
        lineTotal: roundMoney(goodsTotal + mazduriAmount),
      });
    }

    await postPurchaseInvoiceAccounting(
      tx,
      {
        id: invoice.id,
        reference: invoice.reference,
        invoiceDate: invoice.invoiceDate ?? new Date(),
        billNo: invoice.billNo,
        storeId: invoice.storeId,
        debitAccountId: invoice.debitAccountId,
        createdById: invoice.createdById,
      },
      resolvedLines,
    );

    return tx.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.POSTED },
      include: { items: { include: { product: true } } },
    });
  }, WRITE_TRANSACTION_OPTIONS);
}

export function previewPurchaseInvoiceTotals(lines: PurchaseInvoiceLineInput[]) {
  try {
    return computePurchaseInvoiceTotals(lines);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : 'Invalid lines');
  }
}

/** Update a pending purchase invoice in place (no posting). */
export async function updatePendingPurchaseInvoice(
  invoiceId: number,
  data: Omit<CreatePurchaseInvoiceInput, 'createdById'>,
) {
  let totals;
  try {
    totals = computePurchaseInvoiceTotals(data.lines);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : 'Invalid purchase invoice lines');
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findFirst({
      where: {
        id: invoiceId,
        type: InvoiceType.PURCHASE_INVOICE,
        status: InvoiceStatus.PENDING_APPROVAL,
      },
    });
    if (!existing) throw new AppError(404, 'Pending purchase invoice not found');
    await assertActiveFinancialYear(tx, existing.financialYearId);

    let invoiceDate: Date;
    try {
      invoiceDate = parseVoucherDateInput(data.invoiceDate);
    } catch {
      throw new AppError(400, 'Invalid invoice date');
    }
    const financialYearId = await assertVoucherDateInActiveFinancialYear(tx, invoiceDate, 'Invoice');

    await assertActiveStore(data.storeId, tx);
    await assertPurchasePartyAccount(tx, data.supplierAccountId);

    const resolvedLines: ResolvedPurchaseLine[] = [];
    for (const line of totals.lines) {
      const { product, maalKhataAccountId } = await resolveMaalKhataAccountForProduct(tx, line.productId);
      resolvedLines.push({
        productId: product.id,
        productName: product.name,
        maalKhataAccountId,
        quantity: line.quantity,
        rate: line.rate,
        goodsTotal: line.goodsTotal,
        mazduriAmount: line.mazduriAmount,
        lineTotal: line.lineTotal,
      });
    }

    if (totals.mazduriTotal > 0) {
      await ensurePurchaseMazduriAccount(tx);
    }
    buildPurchaseInvoiceLegs(
      data.supplierAccountId,
      resolvedLines,
      totals.mazduriTotal > 0
        ? (await ensurePurchaseMazduriAccount(tx)).id
        : null,
    );

    await tx.invoiceItem.deleteMany({ where: { invoiceId } });

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        invoiceDate,
        billNo: data.billNo?.trim() || null,
        notes: data.notes?.trim() || null,
        storeId: data.storeId,
        debitAccountId: data.supplierAccountId,
        total: totals.invoiceTotal,
        financialYearId,
        status: InvoiceStatus.PENDING_APPROVAL,
        items: {
          create: resolvedLines.map((line) => ({
            productId: line.productId,
            label: line.productName,
            quantity: line.quantity,
            unitPrice: line.rate,
            total: line.goodsTotal,
            mazduriAmount: line.mazduriAmount,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });
  }, WRITE_TRANSACTION_OPTIONS);
}
