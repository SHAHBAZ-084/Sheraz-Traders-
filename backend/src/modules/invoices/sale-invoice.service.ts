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

export async function createSaleInvoice(data: CreateSaleInvoiceInput) {
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

    // Strict per-store stock check — never use another store's balance.
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
      const available = await getCurrentStockBalance(productId, data.storeId, tx);
      if (req.quantity > available) {
        throw new AppError(
          400,
          `Insufficient stock for ${req.name} at selected store: available ${available}, requested ${req.quantity}`,
        );
      }
    }

    const legs: VoucherLeg[] = [
      {
        accountId: data.customerAccountId,
        type: LedgerEntryType.DEBIT,
        amount: totals.invoiceTotal,
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

    const reference = await nextReference(tx);
    const invoiceDate = new Date(data.invoiceDate);
    const financialYearId = await getActiveFinancialYearId(tx);

    const invoice = await tx.invoice.create({
      data: {
        type: InvoiceType.SALE_INVOICE,
        status: InvoiceStatus.POSTED,
        reference,
        invoiceDate,
        billNo: data.billNo?.trim() || null,
        notes: data.notes?.trim() || null,
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

    const voucher = await createMultiLegVoucherInTx(tx, {
      type: VoucherType.SALE_INVOICE,
      legs,
      amount: totals.invoiceTotal,
      date: invoiceDate,
      description: `Sale Invoice ${reference}`,
      reference: voucherReferenceFromBillNo(data.billNo),
      createdById: data.createdById,
    });

    await tx.invoiceVoucher.create({
      data: { invoiceId: invoice.id, voucherId: voucher.id },
    });

    await postSaleInvoiceStockOut(tx, {
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

export function previewSaleInvoiceTotals(lines: SaleInvoiceLineInput[]) {
  try {
    return computeSaleInvoiceTotals(lines);
  } catch (err) {
    throw new AppError(400, err instanceof Error ? err.message : 'Invalid lines');
  }
}
