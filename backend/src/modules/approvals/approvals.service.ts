import { InvoiceStatus, InvoiceType, VoucherStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { approveVoucher } from '../accounting/accounting.service';
import { approveKachiMaalInvoice } from '../invoices/kachi-maal.service';
import { approvePurchaseInvoice } from '../invoices/purchase-invoice.service';
import { approveSaleInvoice } from '../invoices/sale-invoice.service';

export type PendingApprovalItem = {
  kind: 'voucher' | 'invoice';
  id: number;
  type: string;
  reference: string | null;
  date: string | null;
  debitAccountName?: string | null;
  creditAccountName?: string | null;
  amount: number;
  description: string | null;
  createdBy: { id: number; displayName: string; username: string } | null;
};

export async function listPendingApprovals(): Promise<PendingApprovalItem[]> {
  const [vouchers, invoices] = await Promise.all([
    prisma.voucher.findMany({
      where: { status: VoucherStatus.PENDING_APPROVAL },
      include: {
        createdBy: { select: { id: true, displayName: true, username: true } },
        debitAccount: { select: { name: true, code: true } },
        creditAccount: { select: { name: true, code: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invoice.findMany({
      where: { status: InvoiceStatus.PENDING_APPROVAL },
      include: {
        createdBy: { select: { id: true, displayName: true, username: true } },
        debitAccount: { select: { name: true, code: true } },
        customer: { select: { name: true } },
        supplier: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const items: PendingApprovalItem[] = [
    ...vouchers.map((v) => ({
      kind: 'voucher' as const,
      id: v.id,
      type: v.type,
      reference: v.reference,
      date: v.date?.toISOString() ?? null,
      debitAccountName: v.debitAccount ? `${v.debitAccount.name} (${v.debitAccount.code})` : null,
      creditAccountName: v.creditAccount ? `${v.creditAccount.name} (${v.creditAccount.code})` : null,
      amount: Number(v.amount),
      description: v.description,
      createdBy: v.createdBy
        ? {
            id: v.createdBy.id,
            displayName: v.createdBy.displayName ?? v.createdBy.username,
            username: v.createdBy.username,
          }
        : null,
    })),
    ...invoices.map((inv) => ({
      kind: 'invoice' as const,
      id: inv.id,
      type: inv.type,
      reference: inv.reference,
      date: inv.invoiceDate?.toISOString() ?? null,
      debitAccountName: inv.debitAccount ? inv.debitAccount.name : inv.customer ? inv.customer.name : null,
      creditAccountName: inv.supplier ? inv.supplier.name : null,
      amount: Number(inv.total),
      description: inv.notes ?? inv.billNo,
      createdBy: inv.createdBy
        ? {
            id: inv.createdBy.id,
            displayName: inv.createdBy.displayName ?? inv.createdBy.username,
            username: inv.createdBy.username,
          }
        : null,
    })),
  ];

  return items.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
}

export async function approvePendingVoucher(voucherId: number, approvedById: number) {
  return approveVoucher(voucherId, approvedById);
}

export async function rejectPendingVoucher(voucherId: number) {
  const voucher = await prisma.voucher.findFirst({
    where: { id: voucherId, status: VoucherStatus.PENDING_APPROVAL },
  });
  if (!voucher) throw new AppError(404, 'Pending voucher not found');
  await prisma.voucher.delete({ where: { id: voucherId } });
  return { ok: true, id: voucherId };
}

export async function rejectPendingInvoice(invoiceId: number) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, status: InvoiceStatus.PENDING_APPROVAL },
  });
  if (!invoice) throw new AppError(404, 'Pending invoice not found');
  await prisma.invoice.delete({ where: { id: invoiceId } });
  return { ok: true, id: invoiceId };
}

export async function approvePendingInvoice(invoiceId: number) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, status: InvoiceStatus.PENDING_APPROVAL },
    select: { id: true, type: true },
  });
  if (!invoice) throw new AppError(404, 'Pending invoice not found');

  switch (invoice.type) {
    case InvoiceType.SALE_INVOICE:
      return approveSaleInvoice(invoiceId);
    case InvoiceType.PURCHASE_INVOICE:
      return approvePurchaseInvoice(invoiceId);
    case InvoiceType.KACHI_MAAL:
      return approveKachiMaalInvoice(invoiceId);
    default:
      throw new AppError(400, `Cannot approve invoice type ${invoice.type}`);
  }
}
