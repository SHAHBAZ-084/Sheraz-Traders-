import { InvoiceStatus, InvoiceType, Prisma, VoucherStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { PaginatedResult } from '../../utils/pagination';
import { cancelVoucherInTx, getActiveFinancialYearId } from '../accounting/accounting.service';
import { reverseSalePaunchEmptyBardana } from '../inventory/bardana.service';
import { reverseInvoiceStockMovements } from '../stock/stock.service';
import { buildInvoiceReference, INVOICE_TYPE_PREFIX } from './invoice-reference';

export { INVOICE_TYPE_PREFIX, buildInvoiceReference };

const TYPE_PREFIX = INVOICE_TYPE_PREFIX;

async function nextReference(tx: Prisma.TransactionClient, type: InvoiceType) {
  const prefix = TYPE_PREFIX[type];
  const count = await tx.invoice.count({ where: { type } });
  return `${prefix}-${String(count + 1).padStart(5, '0')}`;
}

export async function listInvoices(
  filters?: { type?: InvoiceType; status?: InvoiceStatus },
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<Awaited<ReturnType<typeof fetchInvoiceListPage>>[number]>> {
  const where = {
    ...(filters?.type && { type: filters.type }),
    ...(filters?.status && { status: filters.status }),
  };

  const limit = pagination?.limit ?? 200;
  const offset = pagination?.offset ?? 0;

  const [items, total] = await Promise.all([
    fetchInvoiceListPage(where, limit, offset),
    prisma.invoice.count({ where }),
  ]);

  return { items, total, limit, offset };
}

function fetchInvoiceListPage(
  where: Prisma.InvoiceWhereInput,
  limit: number,
  offset: number,
) {
  return prisma.invoice.findMany({
    where,
    include: {
      customer: true,
      supplier: true,
      items: true,
      createdBy: { select: { id: true, displayName: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

const invoiceDetailInclude = {
  customer: true,
  supplier: true,
  items: { include: { product: true } },
  kachiMaalLines: { include: { partyAccount: true }, orderBy: { sortOrder: 'asc' as const } },
  purchaseMaalLines: { include: { partyAccount: true }, orderBy: { sortOrder: 'asc' as const } },
  salePaunchLines: {
    include: { maalKhataAccount: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  saleCommissionLines: { include: { partyAccount: true }, orderBy: { sortOrder: 'asc' as const } },
  vouchers: {
    include: {
      voucher: {
        include: {
          debitAccount: true,
          creditAccount: true,
          ledgerEntries: {
            where: { isReversal: false },
            orderBy: { id: 'asc' as const },
            include: {
              ledger: {
                include: {
                  account: { select: { id: true, name: true, code: true } },
                },
              },
            },
          },
        },
      },
    },
  },
  debitAccount: true,
  product: { include: { account: true } },
  createdBy: { select: { id: true, displayName: true, username: true } },
} as const;

export async function getInvoice(id: number) {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: invoiceDetailInclude,
  });
  if (!invoice) throw new AppError(404, 'Invoice not found');
  return invoice;
}

export async function getInvoiceByReference(reference: string) {
  const trimmed = reference.trim();
  if (!trimmed) throw new AppError(400, 'Reference is required');

  const invoice = await prisma.invoice.findUnique({
    where: { reference: trimmed },
    include: invoiceDetailInclude,
  });
  if (!invoice) {
    throw new AppError(404, `No invoice found for ${trimmed}.`);
  }
  return invoice;
}

/**
 * Cancel a posted (or pending) invoice: reverse linked vouchers' ledger entries,
 * reverse stock / empty-bardana movements where applicable, set CANCELLED.
 */
export async function cancelInvoice(invoiceId: number, userId: number) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId },
      include: {
        vouchers: { select: { voucherId: true } },
      },
    });
    if (!invoice) throw new AppError(404, 'Invoice not found');
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new AppError(400, 'Invoice is already cancelled');
    }
    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new AppError(400, 'Draft invoices cannot be cancelled this way — delete is not supported for drafts');
    }

    for (const link of invoice.vouchers) {
      const voucher = await tx.voucher.findFirst({ where: { id: link.voucherId } });
      if (!voucher) continue;
      if (voucher.status === VoucherStatus.CANCELLED) continue;
      await cancelVoucherInTx(tx, voucher.id, userId);
    }

    const invoiceDate = invoice.invoiceDate ?? new Date();

    // Stocked invoice types: SI/PI (store-scoped), Purchase Maal, Sale Paunch.
    // STOCK_TRANSFER also has stock movements — reverse those too if cancelled via this path.
    if (
      invoice.type === InvoiceType.SALE_INVOICE ||
      invoice.type === InvoiceType.PURCHASE_INVOICE ||
      invoice.type === InvoiceType.PURCHASE_MAAL ||
      invoice.type === InvoiceType.SALE_PAUNCH ||
      invoice.type === InvoiceType.STOCK_TRANSFER
    ) {
      await reverseInvoiceStockMovements(tx, {
        invoiceId: invoice.id,
        invoiceReference: invoice.reference,
        invoiceDate,
      });
    }

    if (invoice.type === InvoiceType.SALE_PAUNCH) {
      await reverseSalePaunchEmptyBardana(tx, {
        invoiceId: invoice.id,
        invoiceReference: invoice.reference,
        invoiceDate,
      });
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.CANCELLED },
    });

    return tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: invoiceDetailInclude,
    });
  });
}

/** Draft invoice shell — posting with balanced vouchers comes next per invoice type. */
export async function createInvoiceDraft(data: {
  type: InvoiceType;
  customerId?: number;
  supplierId?: number;
  notes?: string;
  items: { productId?: number; label: string; quantity: number; unitPrice: number }[];
  createdById: number;
}) {
  if (data.items.length === 0) throw new AppError(400, 'At least one line item is required');

  const total = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  if (total <= 0) throw new AppError(400, 'Invoice total must be greater than zero');

  return prisma.$transaction(async (tx) => {
    const financialYearId = await getActiveFinancialYearId(tx);
    const reference = await nextReference(tx, data.type);

    return tx.invoice.create({
      data: {
        type: data.type,
        status: InvoiceStatus.DRAFT,
        reference,
        customerId: data.customerId ?? null,
        supplierId: data.supplierId ?? null,
        total,
        notes: data.notes?.trim() || null,
        financialYearId,
        createdById: data.createdById,
        items: {
          create: data.items.map((item) => ({
            productId: item.productId ?? null,
            label: item.label,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.quantity * item.unitPrice,
          })),
        },
      },
      include: { items: true, customer: true, supplier: true },
    });
  });
}
