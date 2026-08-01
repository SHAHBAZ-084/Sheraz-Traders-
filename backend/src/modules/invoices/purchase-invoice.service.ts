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

export async function createPurchaseInvoice(data: CreatePurchaseInvoiceInput) {
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

    const resolvedLines: Array<{
      productId: number;
      productName: string;
      maalKhataAccountId: number;
      quantity: number;
      rate: number;
      lineTotal: number;
    }> = [];

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

    const legs: VoucherLeg[] = [
      ...resolvedLines.map((line) => ({
        accountId: line.maalKhataAccountId,
        type: LedgerEntryType.DEBIT,
        amount: line.lineTotal,
        description: `Purchase Invoice ${line.productName}`,
      })),
      {
        accountId: data.supplierAccountId,
        type: LedgerEntryType.CREDIT,
        amount: totals.invoiceTotal,
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

    const reference = await nextReference(tx);
    const invoiceDate = new Date(data.invoiceDate);
    const financialYearId = await getActiveFinancialYearId(tx);

    const invoice = await tx.invoice.create({
      data: {
        type: InvoiceType.PURCHASE_INVOICE,
        status: InvoiceStatus.POSTED,
        reference,
        invoiceDate,
        billNo: data.billNo?.trim() || null,
        notes: data.notes?.trim() || null,
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

    const voucher = await createMultiLegVoucherInTx(tx, {
      type: VoucherType.PURCHASE_INVOICE,
      legs,
      amount: totals.invoiceTotal,
      date: invoiceDate,
      description: `Purchase Invoice ${reference}`,
      reference: voucherReferenceFromBillNo(data.billNo),
      createdById: data.createdById,
    });

    await tx.invoiceVoucher.create({
      data: { invoiceId: invoice.id, voucherId: voucher.id },
    });

    await postPurchaseInvoiceStockIn(tx, {
      invoiceId: invoice.id,
      invoiceReference: reference,
      invoiceDate,
      storeId: data.storeId,
      lines: resolvedLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
    });

    return invoice;
  });
}

export function previewPurchaseInvoiceTotals(lines: PurchaseInvoiceLineInput[]) {
  try {
    return computePurchaseInvoiceTotals(lines);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : 'Invalid lines');
  }
}
