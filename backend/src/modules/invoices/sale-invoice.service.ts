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
  createMultiLegVoucherInTx,
  getActiveFinancialYearId,
  KACHI_MAAL_CATEGORY_NAMES,
  type VoucherLeg,
} from '../accounting/accounting.service';
import { resolveMaalKhataAccountForProduct } from '../products/maal-khata';
import { assertActiveStore } from '../stores/stores.service';
import { getCurrentStockBalance, postSaleInvoiceStockOut } from '../stock/stock.service';
import { voucherReferenceFromBillNo } from './invoice-voucher-descriptions';
import {
  computeSaleInvoiceTotals,
  roundMoney,
  type SaleInvoiceLineInput,
} from './sale-invoice.calculations';

const TYPE_PREFIX = 'SI';

async function nextReference(tx: Prisma.TransactionClient) {
  const count = await tx.invoice.count({ where: { type: InvoiceType.SALE_INVOICE } });
  return `${TYPE_PREFIX}-${String(count + 1).padStart(5, '0')}`;
}

export async function getNextSaleInvoiceReference() {
  return prisma.$transaction(async (tx) => nextReference(tx));
}

export type CreateSaleInvoiceInput = {
  invoiceDate: string;
  billNo?: string;
  notes?: string;
  storeId: number;
  customerAccountId: number;
  createdById: number;
  lines: SaleInvoiceLineInput[];
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
  const account = await tx.account.findFirst({
    where: { id: accountId, isActive: true },
    include: { category: true },
  });
  if (!account) throw new AppError(400, 'Customer account not found');
  if (account.category.name !== KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY) {
    throw new AppError(400, 'Customer must be a Sale Party account');
  }
  return account;
}

function buildSaleInvoiceLegs(
  customerAccountId: number,
  resolvedLines: ResolvedSaleLine[],
  invoiceTotal: number,
): VoucherLeg[] {
  const legs: VoucherLeg[] = [
    {
      accountId: customerAccountId,
      type: LedgerEntryType.DEBIT,
      amount: invoiceTotal,
      description: 'Sale Invoice customer',
    },
    ...resolvedLines.map((line) => ({
      accountId: line.maalKhataAccountId,
      type: LedgerEntryType.CREDIT,
      amount: line.lineTotal,
      description: `Sale Invoice ${line.productName}`,
    })),
  ];

  const totalDebits = roundMoney(
    legs.filter((l) => l.type === LedgerEntryType.DEBIT).reduce((s, l) => s + l.amount, 0),
  );
  const totalCredits = roundMoney(
    legs.filter((l) => l.type === LedgerEntryType.CREDIT).reduce((s, l) => s + l.amount, 0),
  );
  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new AppError(500, 'Sale Invoice voucher debits and credits do not balance');
  }
  return legs;
}

async function assertSaleStockAvailable(
  tx: Prisma.TransactionClient,
  storeId: number,
  resolvedLines: Array<{ productId: number; productName: string; quantity: number }>,
) {
  const requestedByProduct = new Map<number, { name: string; quantity: number }>();
  for (const line of resolvedLines) {
    const prev = requestedByProduct.get(line.productId);
    if (prev) {
      prev.quantity += line.quantity;
    } else {
      requestedByProduct.set(line.productId, {
        name: line.productName,
        quantity: line.quantity,
      });
    }
  }
  for (const [productId, req] of requestedByProduct) {
    const available = await getCurrentStockBalance(productId, storeId, tx);
    if (req.quantity > available) {
      throw new AppError(
        400,
        `Insufficient stock for ${req.name} at selected store: available ${available}, requested ${req.quantity}`,
      );
    }
  }
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
  const legs = buildSaleInvoiceLegs(
    invoice.debitAccountId,
    resolvedLines,
    Number(invoice.total),
  );

  const voucher = await createMultiLegVoucherInTx(tx, {
    type: VoucherType.SALE_INVOICE,
    legs,
    amount: Number(invoice.total),
    date: invoice.invoiceDate,
    description: `Sale Invoice ${invoice.reference}`,
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
    await getActiveFinancialYearId(tx);
    await assertActiveStore(data.storeId);
    await assertSalePartyAccount(tx, data.customerAccountId);

    const resolvedLines: ResolvedSaleLine[] = [];

    for (const line of totals.lines) {
      const { product, maalKhataAccountId } = await resolveMaalKhataAccountForProduct(tx, line.productId);
      resolvedLines.push({
        productId: product.id,
        productName: product.name,
        maalKhataAccountId,
        quantity: line.quantity,
        rate: line.rate,
        lineTotal: line.lineTotal,
      });
    }

    // Strict per-store stock check — never use another store's balance.
    await assertSaleStockAvailable(tx, data.storeId, resolvedLines);

    buildSaleInvoiceLegs(data.customerAccountId, resolvedLines, totals.invoiceTotal);

    const reference = await nextReference(tx);
    const invoiceDate = new Date(data.invoiceDate);
    const financialYearId = await getActiveFinancialYearId(tx);

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

    return invoice;
  });
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
    if (invoice.storeId == null) throw new AppError(400, 'Sale invoice missing store');
    if (invoice.debitAccountId == null) throw new AppError(400, 'Sale invoice missing customer');

    await assertActiveStore(invoice.storeId);
    await assertSalePartyAccount(tx, invoice.debitAccountId);

    const resolvedLines: ResolvedSaleLine[] = [];
    for (const item of invoice.items) {
      if (item.productId == null) throw new AppError(400, 'Sale invoice line missing product');
      const { product, maalKhataAccountId } = await resolveMaalKhataAccountForProduct(tx, item.productId);
      resolvedLines.push({
        productId: product.id,
        productName: product.name,
        maalKhataAccountId,
        quantity: Number(item.quantity),
        rate: Number(item.unitPrice),
        lineTotal: Number(item.total),
      });
    }

    await assertSaleStockAvailable(tx, invoice.storeId, resolvedLines);

    await postSaleInvoiceAccounting(
      tx,
      {
        id: invoice.id,
        reference: invoice.reference,
        invoiceDate: invoice.invoiceDate,
        billNo: invoice.billNo,
        storeId: invoice.storeId,
        debitAccountId: invoice.debitAccountId,
        total: invoice.total,
        createdById: invoice.createdById,
      },
      resolvedLines,
    );

    return tx.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.POSTED },
      include: { items: { include: { product: true } } },
    });
  });
}

export function previewSaleInvoiceTotals(lines: SaleInvoiceLineInput[]) {
  try {
    return computeSaleInvoiceTotals(lines);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : 'Invalid lines');
  }
}
