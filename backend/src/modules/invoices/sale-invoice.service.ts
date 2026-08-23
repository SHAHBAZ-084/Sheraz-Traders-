import {
  InvoiceStatus,
  InvoiceType,
  LedgerEntryType,
  Prisma,
  RecordStatus,
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
import { getCurrentStockBalance, postSaleInvoiceStockOut } from '../stock/stock.service';
import { voucherReferenceFromBillNo, formatInvoiceProductLinesDescription } from './invoice-voucher-descriptions';
import {
  parseEmbeddedReceiptLinesInput,
  syncEmbeddedSaleReceiptsInTx,
  type EmbeddedReceiptLineInput,
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
  receipts?: Array<{ amount: number; accountId: number }>;
  /** @deprecated Use receipts array */
  receiptAmount?: number;
  /** @deprecated Use receipts array */
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

type ResolvedSaleCost = {
  avgCost: number;
  /** Extra note appended to inventory/revenue leg descriptions when cost is provisional. */
  costNote?: string;
};

async function findPendingStockAdjustmentRate(
  tx: Prisma.TransactionClient,
  productId: number,
): Promise<{ id: number; rate: number } | null> {
  const pending = await tx.pendingAdjustment.findFirst({
    where: {
      kind: 'STOCK',
      status: RecordStatus.PENDING_APPROVAL,
      productId,
      rate: { not: null },
    },
    orderBy: { id: 'desc' },
    select: { id: true, rate: true, kachiOpening: true, product: { select: { kind: true } } },
  });
  if (!pending) return null;

  const rate = pending.rate != null ? Number(pending.rate) : NaN;
  if (Number.isFinite(rate) && rate > 0) {
    return { id: pending.id, rate };
  }

  // Kachi pending adjustments store rate inside kachiOpening JSON.
  const kachi = pending.kachiOpening;
  if (kachi && typeof kachi === 'object' && kachi !== null && 'ratePerMaund' in kachi) {
    const ratePerMaund = Number((kachi as { ratePerMaund?: number }).ratePerMaund);
    if (Number.isFinite(ratePerMaund) && ratePerMaund > 0) {
      return { id: pending.id, rate: ratePerMaund };
    }
  }
  return null;
}

async function averageCostFromLedgerStock(
  tx: Prisma.TransactionClient,
  productId: number,
  maalKhataAccountId: number,
): Promise<number | null> {
  const [stockQty, ledger] = await Promise.all([
    getCurrentStockBalance(productId, null, tx),
    tx.ledger.findFirst({
      where: { accountId: maalKhataAccountId },
      select: { balance: true },
    }),
  ]);
  if (!(stockQty > 0) || !ledger) return null;
  const balance = Number(ledger.balance);
  if (!(balance > 0)) return null;
  return balance / stockQty;
}

async function resolveAverageCostForSaleLine(
  tx: Prisma.TransactionClient,
  line: ResolvedSaleLine,
  productAverageCost: number | null,
): Promise<ResolvedSaleCost> {
  if (productAverageCost != null && Number.isFinite(productAverageCost)) {
    return { avgCost: productAverageCost };
  }

  const fromPurchases = await averagePurchaseRateForProduct(tx, line.productId);
  if (fromPurchases != null) {
    return { avgCost: fromPurchases };
  }

  const fromLedger = await averageCostFromLedgerStock(tx, line.productId, line.maalKhataAccountId);
  if (fromLedger != null) {
    return { avgCost: fromLedger };
  }

  const pending = await findPendingStockAdjustmentRate(tx, line.productId);
  if (pending) {
    return {
      avgCost: pending.rate,
      costNote: `cost basis from pending Stock Adjustment #${pending.id}, pending approval`,
    };
  }

  throw new AppError(
    400,
    `“${line.productName}” has no recorded cost. Go to Stock Adjustment, add stock with a rate for this product, then approve it in Pending Approvals (or enter Opening Stock / a Purchase Invoice).`,
  );
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
    const { avgCost, costNote } = await resolveAverageCostForSaleLine(tx, line, avgCostFromField);

    const costAmount = roundMoney(avgCost * line.quantity);
    const profitAmount = roundMoney(line.lineTotal - costAmount);
    const legDescription = costNote
      ? `${productDescription} (${costNote})`
      : productDescription;

    // Inventory leg (cost only)
    legs.push({
      accountId: line.maalKhataAccountId,
      type: LedgerEntryType.CREDIT,
      amount: costAmount,
      description: legDescription,
    });

    // Sales revenue leg (profit, can be a loss => debit)
    if (profitAmount >= 0) {
      legs.push({
        accountId: salesRevenueAccountId,
        type: LedgerEntryType.CREDIT,
        amount: profitAmount,
        description: legDescription,
      });
    } else {
      legs.push({
        accountId: salesRevenueAccountId,
        type: LedgerEntryType.DEBIT,
        amount: Math.abs(profitAmount),
        description: legDescription,
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
}

function embeddedReceiptScalarFields(receipts: EmbeddedReceiptLineInput[]) {
  if (receipts.length === 0) {
    return { embeddedReceiptAmount: null, embeddedReceiptAccountId: null };
  }
  const sum = roundMoney(receipts.reduce((total, line) => total + line.amount, 0));
  return {
    embeddedReceiptAmount: sum,
    embeddedReceiptAccountId: receipts[0].accountId,
  };
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

    const embeddedReceipts = parseEmbeddedReceiptLinesInput(
      {
        receipts: data.receipts,
        receiptAmount: data.receiptAmount,
        receiptAccountId: data.receiptAccountId,
      },
      totals.invoiceTotal,
    );
    const receiptScalars = embeddedReceiptScalarFields(embeddedReceipts);

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
        ...receiptScalars,
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
      );
    }

    if (embeddedReceipts.length > 0) {
      await syncEmbeddedSaleReceiptsInTx(tx, {
        invoiceId: invoice.id,
        customerAccountId: data.customerAccountId,
        receipts: embeddedReceipts,
        invoiceDate,
        invoiceReference: reference,
        createdById: data.createdById,
      });
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
    );

    const existingEmbedded = await tx.invoiceVoucher.count({
      where: { invoiceId: invoice.id, voucher: { type: VoucherType.SALE_RECEIPT } },
    });
    if (existingEmbedded === 0) {
      const embeddedReceipts = parseEmbeddedReceiptLinesInput(
        {
          receiptAmount:
            invoice.embeddedReceiptAmount != null ? Number(invoice.embeddedReceiptAmount) : undefined,
          receiptAccountId: invoice.embeddedReceiptAccountId ?? undefined,
        },
        Number(invoice.total),
      );
      if (embeddedReceipts.length > 0) {
        await syncEmbeddedSaleReceiptsInTx(tx, {
          invoiceId: invoice.id,
          customerAccountId: invoice.debitAccountId,
          receipts: embeddedReceipts,
          invoiceDate: invoice.invoiceDate ?? new Date(),
          invoiceReference: invoice.reference,
          createdById: invoice.createdById,
        });
      }
    }

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

    const embeddedReceipts = parseEmbeddedReceiptLinesInput(
      {
        receipts: data.receipts,
        receiptAmount: data.receiptAmount,
        receiptAccountId: data.receiptAccountId,
      },
      totals.invoiceTotal,
    );
    const receiptScalars = embeddedReceiptScalarFields(embeddedReceipts);

    await tx.invoiceItem.deleteMany({ where: { invoiceId } });

    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        invoiceDate,
        billNo: data.billNo?.trim() || null,
        notes: data.notes?.trim() || null,
        storeId: data.storeId,
        debitAccountId: data.customerAccountId,
        total: totals.invoiceTotal,
        financialYearId,
        ...receiptScalars,
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

    await syncEmbeddedSaleReceiptsInTx(tx, {
      invoiceId,
      customerAccountId: data.customerAccountId,
      receipts: embeddedReceipts,
      invoiceDate,
      invoiceReference: existing.reference,
      createdById: existing.createdById,
    });

    return updated;
  }, WRITE_TRANSACTION_OPTIONS);
}
