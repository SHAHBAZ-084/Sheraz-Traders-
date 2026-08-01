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
import { postPurchaseInvoiceStockIn } from '../stock/stock.service';
import { voucherReferenceFromBillNo } from './invoice-voucher-descriptions';
import {
  computePurchaseInvoiceTotals,
  roundMoney,
  type PurchaseInvoiceLineInput,
} from './purchase-invoice.calculations';

const TYPE_PREFIX = 'PI';

async function nextReference(tx: Prisma.TransactionClient) {
  const count = await tx.invoice.count({ where: { type: InvoiceType.PURCHASE_INVOICE } });
  return `${TYPE_PREFIX}-${String(count + 1).padStart(5, '0')}`;
}

export async function getNextPurchaseInvoiceReference() {
  return prisma.$transaction(async (tx) => nextReference(tx));
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
  lineTotal: number;
};

async function assertPurchasePartyAccount(tx: Prisma.TransactionClient, accountId: number) {
  const account = await tx.account.findFirst({
    where: { id: accountId, isActive: true },
    include: { category: true },
  });
  if (!account) throw new AppError(400, 'Supplier account not found');
  const allowed = new Set([
    KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE,
    KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE,
  ]);
  if (!allowed.has(account.category.name)) {
    throw new AppError(400, 'Supplier must be an Int./Ext. Purchase Party account');
  }
  return account;
}

function buildPurchaseInvoiceLegs(
  supplierAccountId: number,
  resolvedLines: ResolvedPurchaseLine[],
  invoiceTotal: number,
): VoucherLeg[] {
  const legs: VoucherLeg[] = [
    ...resolvedLines.map((line) => ({
      accountId: line.maalKhataAccountId,
      type: LedgerEntryType.DEBIT,
      amount: line.lineTotal,
      description: `Purchase Invoice ${line.productName}`,
    })),
    {
      accountId: supplierAccountId,
      type: LedgerEntryType.CREDIT,
      amount: invoiceTotal,
      description: 'Purchase Invoice supplier',
    },
  ];

  const totalDebits = roundMoney(
    legs.filter((l) => l.type === LedgerEntryType.DEBIT).reduce((s, l) => s + l.amount, 0),
  );
  const totalCredits = roundMoney(
    legs.filter((l) => l.type === LedgerEntryType.CREDIT).reduce((s, l) => s + l.amount, 0),
  );
  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new AppError(500, 'Purchase Invoice voucher debits and credits do not balance');
  }
  return legs;
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
    total: Prisma.Decimal | number;
    createdById: number;
  },
  resolvedLines: ResolvedPurchaseLine[],
) {
  const legs = buildPurchaseInvoiceLegs(
    invoice.debitAccountId,
    resolvedLines,
    Number(invoice.total),
  );

  const voucher = await createMultiLegVoucherInTx(tx, {
    type: VoucherType.PURCHASE_INVOICE,
    legs,
    amount: Number(invoice.total),
    date: invoice.invoiceDate,
    description: `Purchase Invoice ${invoice.reference}`,
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
    await getActiveFinancialYearId(tx);
    await assertActiveStore(data.storeId);
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
        lineTotal: line.lineTotal,
      });
    }

    buildPurchaseInvoiceLegs(data.supplierAccountId, resolvedLines, totals.invoiceTotal);

    const reference = await nextReference(tx);
    const invoiceDate = new Date(data.invoiceDate);
    const financialYearId = await getActiveFinancialYearId(tx);

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
            total: line.lineTotal,
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
          total: totals.invoiceTotal,
          createdById: data.createdById,
        },
        resolvedLines,
      );
    }

    return invoice;
  });
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
    if (invoice.storeId == null) throw new AppError(400, 'Purchase invoice missing store');
    if (invoice.debitAccountId == null) throw new AppError(400, 'Purchase invoice missing supplier');

    await assertActiveStore(invoice.storeId);
    await assertPurchasePartyAccount(tx, invoice.debitAccountId);

    const resolvedLines: ResolvedPurchaseLine[] = [];
    for (const item of invoice.items) {
      if (item.productId == null) throw new AppError(400, 'Purchase invoice line missing product');
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

    await postPurchaseInvoiceAccounting(
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

export function previewPurchaseInvoiceTotals(lines: PurchaseInvoiceLineInput[]) {
  try {
    return computePurchaseInvoiceTotals(lines);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : 'Invalid lines');
  }
}
