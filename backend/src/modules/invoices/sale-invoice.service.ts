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
  ensureSalesRevenueAccount,
  getActiveFinancialYearId,
  WRITE_TRANSACTION_OPTIONS,
  type VoucherLeg,
} from '../accounting/accounting.service';
import { parseVoucherDateInput } from '../accounting/ledger-utils';
import { resolveMaalKhataAccountsForProductIds } from '../products/maal-khata';
import { assertActiveStore } from '../stores/stores.service';
import { postSaleInvoiceStockOut } from '../stock/stock.service';
import { voucherReferenceFromBillNo, formatInvoiceProductLinesDescription } from './invoice-voucher-descriptions';
import {
  createEmbeddedSaleReceiptInTx,
  parseEmbeddedReceiptInput,
  type EmbeddedReceiptInput,
} from './invoice-embedded-voucher';
import { nextInvoiceReferenceInTx } from './invoice-reference';
import {
  computeSaleInvoiceTotals,
  roundMoney,
  type SaleInvoiceLineInput,
} from './sale-invoice.calculations';

const TYPE_PREFIX = 'SI';

export async function getNextSaleInvoiceReference() {
  return prisma.$transaction(async (tx) => {
    const financialYearId = await getActiveFinancialYearId(tx);
    return nextInvoiceReferenceInTx(tx, InvoiceType.SALE_INVOICE, financialYearId);
  });
}

export type CreateSaleInvoiceInput = {
  invoiceDate: string;
  billNo?: string;
  notes?: string;
  storeId: number;
  customerAccountId: number;
  createdById: number;
  lines: SaleInvoiceLineInput[];
  receiptAmount?: number;
  receiptAccountId?: number;
};

type ResolvedSaleLine = {
  productId: number;
  productName: string;
  maalKhataAccountId: number;
  quantity: number;
  rate: number;
  lineTotal: number;
};

async function assertSalePartyAccount(tx: Prisma.TransactionClient, accountId: number) {
  return assertPartyAccount(tx, accountId, 'Customer');
}

async function averagePurchaseRateForProduct(tx: Prisma.TransactionClient, productId: number) {
  // Fallback used only when Product.averageCost is still NULL.
  const items = await tx.invoiceItem.findMany({
    where: {
      productId,
      invoice: {
        type: InvoiceType.PURCHASE_INVOICE,
        status: InvoiceStatus.POSTED,
      },
    },
    select: { quantity: true, unitPrice: true },
  });

  let totalQty = 0;
  let totalValue = 0;
  for (const item of items) {
    const qty = Number(item.quantity);
    totalQty += qty;
    totalValue += qty * Number(item.unitPrice);
  }
  return totalQty > 0 ? totalValue / totalQty : null;
}

async function buildSaleInvoiceLegs(
  tx: Prisma.TransactionClient,
  customerAccountId: number,
  resolvedLines: ResolvedSaleLine[],
  invoiceTotal: number,
): Promise<{ legs: VoucherLeg[]; productDescription: string }> {
  const productDescription = formatInvoiceProductLinesDescription(
    resolvedLines.map((line) => ({
      productName: line.productName,
      quantity: line.quantity,
      rate: line.rate,
    })),
  );

  const salesRevenueAccount = await ensureSalesRevenueAccount(tx);
  const salesRevenueAccountId = salesRevenueAccount.id;

  const productIds = [...new Set(resolvedLines.map((l) => l.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, averageCost: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  // Compute cost + profit per line using CURRENT averageCost per product.
  const legs: VoucherLeg[] = [
    {
      accountId: customerAccountId,
      type: LedgerEntryType.DEBIT,
      amount: invoiceTotal,
      description: productDescription,
    },
  ];

  for (const line of resolvedLines) {
    const product = productById.get(line.productId);
    const avgCostFromField = product?.averageCost != null ? Number(product.averageCost) : null;
    const avgCost =
      avgCostFromField != null ? avgCostFromField : await averagePurchaseRateForProduct(tx, line.productId);

    if (avgCost == null) {
      throw new AppError(
        400,
        'Product average cost is not initialized yet. Add a Purchase Invoice / Stock Adjustment first (or ensure Product has opening stock).',
      );
    }

    const costAmount = roundMoney(avgCost * line.quantity);
    const profitAmount = roundMoney(line.lineTotal - costAmount);

    // Inventory leg (cost only)
    legs.push({
      accountId: line.maalKhataAccountId,
      type: LedgerEntryType.CREDIT,
      amount: costAmount,
      description: productDescription,
    });

    // Sales revenue leg (profit, can be a loss => debit)
    if (profitAmount >= 0) {
      legs.push({
        accountId: salesRevenueAccountId,
        type: LedgerEntryType.CREDIT,
        amount: profitAmount,
        description: productDescription,
      });
    } else {
      legs.push({
        accountId: salesRevenueAccountId,
        type: LedgerEntryType.DEBIT,
        amount: Math.abs(profitAmount),
        description: productDescription,
      });
    }
  }

  const totalDebits = roundMoney(
    legs.filter((l) => l.type === LedgerEntryType.DEBIT).reduce((s, l) => s + l.amount, 0),
  );
  const totalCredits = roundMoney(
    legs.filter((l) => l.type === LedgerEntryType.CREDIT).reduce((s, l) => s + l.amount, 0),
  );
  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new AppError(500, 'Sale Invoice voucher debits and credits do not balance');
  }
  return { legs, productDescription };
}

async function postSaleInvoiceAccounting(
  tx: Prisma.TransactionClient,
  invoice: {
    id: number;
    reference: string;
    invoiceDate: Date;
    billNo: string | null;
    storeId: number;
    debitAccountId: number;
    total: Prisma.Decimal | number;
    createdById: number;
  },
  resolvedLines: ResolvedSaleLine[],
  embeddedReceipt: EmbeddedReceiptInput | null,
) {
  const { legs, productDescription } = await buildSaleInvoiceLegs(
    tx,
    invoice.debitAccountId,
    resolvedLines,
    Number(invoice.total),
  );

  const voucher = await createMultiLegVoucherInTx(tx, {
    type: VoucherType.SALE_INVOICE,
    legs,
    amount: Number(invoice.total),
    date: invoice.invoiceDate,
    description: productDescription,
    reference: voucherReferenceFromBillNo(invoice.billNo ?? undefined),
    createdById: invoice.createdById,
  });

  await tx.invoiceVoucher.create({
    data: { invoiceId: invoice.id, voucherId: voucher.id },
  });

  await postSaleInvoiceStockOut(tx, {
    invoiceId: invoice.id,
    invoiceReference: invoice.reference,
    invoiceDate: invoice.invoiceDate,
    storeId: invoice.storeId,
    lines: resolvedLines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
    })),
  });

  if (embeddedReceipt) {
    await createEmbeddedSaleReceiptInTx(tx, {
      invoiceId: invoice.id,
      customerAccountId: invoice.debitAccountId,
      receipt: embeddedReceipt,
      invoiceDate: invoice.invoiceDate,
      invoiceReference: invoice.reference,
      createdById: invoice.createdById,
    });
  }
}

export async function createSaleInvoice(
  data: CreateSaleInvoiceInput,
  opts?: { postImmediately?: boolean },
) {
  const postImmediately = opts?.postImmediately !== false;
  let totals;
  try {
    totals = computeSaleInvoiceTotals(data.lines);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : 'Invalid sale invoice lines');
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
    await assertSalePartyAccount(tx, data.customerAccountId);

    const resolvedLines: ResolvedSaleLine[] = [];
    const maalKhataByProductId = await resolveMaalKhataAccountsForProductIds(
      tx,
      totals.lines.map((line) => line.productId),
    );

    for (const line of totals.lines) {
      const { product, maalKhataAccountId } = maalKhataByProductId.get(line.productId)!;
      resolvedLines.push({
        productId: product.id,
        productName: product.name,
        maalKhataAccountId,
        quantity: line.quantity,
        rate: line.rate,
        lineTotal: line.lineTotal,
      });
    }

    await buildSaleInvoiceLegs(tx, data.customerAccountId, resolvedLines, totals.invoiceTotal);

    const embeddedReceipt = parseEmbeddedReceiptInput(
      data.receiptAmount,
      data.receiptAccountId,
      totals.invoiceTotal,
    );

    const reference = await nextInvoiceReferenceInTx(tx, InvoiceType.SALE_INVOICE, financialYearId);

    const invoice = await tx.invoice.create({
      data: {
        type: InvoiceType.SALE_INVOICE,
        status: postImmediately ? InvoiceStatus.POSTED : InvoiceStatus.PENDING_APPROVAL,
        reference,
        invoiceDate,
        billNo: data.billNo?.trim() || null,
        notes: data.notes?.trim() || null,
        storeId: data.storeId,
        debitAccountId: data.customerAccountId,
        total: totals.invoiceTotal,
        financialYearId,
        embeddedReceiptAmount: embeddedReceipt?.amount ?? null,
        embeddedReceiptAccountId: embeddedReceipt?.accountId ?? null,
        createdById: data.createdById,
        items: {
          create: resolvedLines.map((line) => ({
            productId: line.productId,
            label: line.productName,
            quantity: line.quantity,
            unitPrice: line.rate,
            total: line.lineTotal,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });

    if (postImmediately) {
      await postSaleInvoiceAccounting(
        tx,
        {
          id: invoice.id,
          reference,
          invoiceDate,
          billNo: invoice.billNo,
          storeId: data.storeId,
          debitAccountId: data.customerAccountId,
          total: totals.invoiceTotal,
          createdById: data.createdById,
        },
        resolvedLines,
        embeddedReceipt,
      );
    }

    return invoice;
  }, WRITE_TRANSACTION_OPTIONS);
}

export async function approveSaleInvoice(invoiceId: number) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: {
        id: invoiceId,
        type: InvoiceType.SALE_INVOICE,
        status: InvoiceStatus.PENDING_APPROVAL,
      },
      include: { items: { include: { product: true } } },
    });
    if (!invoice) throw new AppError(404, 'Pending sale invoice not found');
    await assertActiveFinancialYear(tx, invoice.financialYearId);
    if (invoice.storeId == null) throw new AppError(400, 'Sale invoice missing store');
    if (invoice.debitAccountId == null) throw new AppError(400, 'Sale invoice missing customer');

    await assertActiveStore(invoice.storeId, tx);
    await assertSalePartyAccount(tx, invoice.debitAccountId);

    const resolvedLines: ResolvedSaleLine[] = [];
    const maalKhataByProductId = await resolveMaalKhataAccountsForProductIds(
      tx,
      invoice.items.map((item) => {
        if (item.productId == null) throw new AppError(400, 'Sale invoice line missing product');
        return item.productId;
      }),
    );
    for (const item of invoice.items) {
      if (item.productId == null) throw new AppError(400, 'Sale invoice line missing product');
      const { product, maalKhataAccountId } = maalKhataByProductId.get(item.productId)!;
      resolvedLines.push({
        productId: product.id,
        productName: product.name,
        maalKhataAccountId,
        quantity: Number(item.quantity),
        rate: Number(item.unitPrice),
        lineTotal: Number(item.total),
      });
    }

    await postSaleInvoiceAccounting(
      tx,
      {
        id: invoice.id,
        reference: invoice.reference,
        invoiceDate: invoice.invoiceDate ?? new Date(),
        billNo: invoice.billNo,
        storeId: invoice.storeId,
        debitAccountId: invoice.debitAccountId,
        total: invoice.total,
        createdById: invoice.createdById,
      },
      resolvedLines,
      parseEmbeddedReceiptInput(
        invoice.embeddedReceiptAmount != null ? Number(invoice.embeddedReceiptAmount) : undefined,
        invoice.embeddedReceiptAccountId ?? undefined,
        Number(invoice.total),
      ),
    );

    return tx.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.POSTED },
      include: { items: { include: { product: true } } },
    });
  }, WRITE_TRANSACTION_OPTIONS);
}

export function previewSaleInvoiceTotals(lines: SaleInvoiceLineInput[]) {
  try {
    return computeSaleInvoiceTotals(lines);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : 'Invalid lines');
  }
}

/** Update a pending sale invoice in place (no posting). */
export async function updatePendingSaleInvoice(
  invoiceId: number,
  data: Omit<CreateSaleInvoiceInput, 'createdById'>,
) {
  let totals;
  try {
    totals = computeSaleInvoiceTotals(data.lines);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : 'Invalid sale invoice lines');
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findFirst({
      where: {
        id: invoiceId,
        type: InvoiceType.SALE_INVOICE,
        status: InvoiceStatus.PENDING_APPROVAL,
      },
    });
    if (!existing) throw new AppError(404, 'Pending sale invoice not found');
    await assertActiveFinancialYear(tx, existing.financialYearId);

    let invoiceDate: Date;
    try {
      invoiceDate = parseVoucherDateInput(data.invoiceDate);
    } catch {
      throw new AppError(400, 'Invalid invoice date');
    }
    const financialYearId = await assertVoucherDateInActiveFinancialYear(tx, invoiceDate, 'Invoice');

    await assertActiveStore(data.storeId, tx);
    await assertSalePartyAccount(tx, data.customerAccountId);

    const resolvedLines: ResolvedSaleLine[] = [];
    const maalKhataByProductId = await resolveMaalKhataAccountsForProductIds(
      tx,
      totals.lines.map((line) => line.productId),
    );
    for (const line of totals.lines) {
      const { product, maalKhataAccountId } = maalKhataByProductId.get(line.productId)!;
      resolvedLines.push({
        productId: product.id,
        productName: product.name,
        maalKhataAccountId,
        quantity: line.quantity,
        rate: line.rate,
        lineTotal: line.lineTotal,
      });
    }

    await buildSaleInvoiceLegs(tx, data.customerAccountId, resolvedLines, totals.invoiceTotal);

    const embeddedReceipt = parseEmbeddedReceiptInput(
      data.receiptAmount,
      data.receiptAccountId,
      totals.invoiceTotal,
    );

    await tx.invoiceItem.deleteMany({ where: { invoiceId } });

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        invoiceDate,
        billNo: data.billNo?.trim() || null,
        notes: data.notes?.trim() || null,
        storeId: data.storeId,
        debitAccountId: data.customerAccountId,
        total: totals.invoiceTotal,
        financialYearId,
        embeddedReceiptAmount: embeddedReceipt?.amount ?? null,
        embeddedReceiptAccountId: embeddedReceipt?.accountId ?? null,
        status: InvoiceStatus.PENDING_APPROVAL,
        items: {
          create: resolvedLines.map((line) => ({
            productId: line.productId,
            label: line.productName,
            quantity: line.quantity,
            unitPrice: line.rate,
            total: line.lineTotal,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });
  }, WRITE_TRANSACTION_OPTIONS);
}
