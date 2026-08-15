import { InvoiceStatus, InvoiceType, Prisma, VoucherStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { DEFAULT_PAGE_SIZE, PaginatedResult } from '../../utils/pagination';
import { cancelVoucherInTx, assertActiveFinancialYear, getActiveFinancialYearId } from '../accounting/accounting.service';
import { reverseInvoiceStockMovements } from '../stock/stock.service';
import { buildInvoiceReference, INVOICE_TYPE_PREFIX, nextInvoiceReferenceInTx } from './invoice-reference';

export { INVOICE_TYPE_PREFIX, buildInvoiceReference };

const TYPE_PREFIX = INVOICE_TYPE_PREFIX;

async function nextReference(
  tx: Prisma.TransactionClient,
  type: InvoiceType,
  financialYearId: number,
) {
  return nextInvoiceReferenceInTx(tx, type, financialYearId);
}

export async function listInvoices(
  filters?: { type?: InvoiceType; status?: InvoiceStatus; financialYearId?: number },
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<Awaited<ReturnType<typeof fetchInvoiceListPage>>[number]>> {
  const where = {
    ...(filters?.type && { type: filters.type }),
    ...(filters?.status && { status: filters.status }),
    ...(filters?.financialYearId != null && { financialYearId: filters.financialYearId }),
  };

  const limit = pagination?.limit ?? DEFAULT_PAGE_SIZE;
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

  const activeFyId = await getActiveFinancialYearId(prisma);
  let invoice = await prisma.invoice.findFirst({
    where: { reference: trimmed, financialYearId: activeFyId },
    include: invoiceDetailInclude,
  });
  if (!invoice) {
    invoice = await prisma.invoice.findFirst({
      where: { reference: trimmed },
      orderBy: { createdAt: 'desc' },
      include: invoiceDetailInclude,
    });
  }
  if (!invoice) {
    throw new AppError(404, `No invoice found for ${trimmed}.`);
  }
  return invoice;
}

/**
 * Cancel a posted (or pending) invoice: reverse linked vouchers' ledger entries,
 * reverse stock movements where applicable, set CANCELLED.
 */
export async function cancelInvoiceInTx(
  tx: Prisma.TransactionClient,
  invoiceId: number,
  userId: number,
) {
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
  await assertActiveFinancialYear(tx, invoice.financialYearId);

  for (const link of invoice.vouchers) {
    const voucher = await tx.voucher.findFirst({ where: { id: link.voucherId } });
    if (!voucher) continue;
    if (voucher.status === VoucherStatus.CANCELLED) continue;
    await cancelVoucherInTx(tx, voucher.id, userId);
  }

  const invoiceDate = invoice.invoiceDate ?? new Date();

  if (
    invoice.type === InvoiceType.SALE_INVOICE ||
    invoice.type === InvoiceType.PURCHASE_INVOICE ||
    invoice.type === InvoiceType.STOCK_TRANSFER
  ) {
    await reverseInvoiceStockMovements(tx, {
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
}

export async function cancelInvoice(invoiceId: number, userId: number) {
  return prisma.$transaction(async (tx) => {
    return cancelInvoiceInTx(tx, invoiceId, userId);
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
    const reference = await nextReference(tx, data.type, financialYearId);
    return tx.invoice.create({
      data: {
        type: data.type,
        status: InvoiceStatus.DRAFT,
        reference,
        customerId: data.customerId,
        supplierId: data.supplierId,
        notes: data.notes,
        total,
        financialYearId,
        createdById: data.createdById,
        items: {
          create: data.items.map((item) => ({
            productId: item.productId,
            label: item.label,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.quantity * item.unitPrice,
          })),
        },
      },
      include: invoiceDetailInclude,
    });
  });
}
