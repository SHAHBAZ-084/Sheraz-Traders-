import { InvoiceStatus, InvoiceType, VoucherStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { approveVoucher } from '../accounting/accounting.service';
import { approveKachiMaalInvoice } from '../invoices/kachi-maal.service';
import { approvePurchaseInvoice } from '../invoices/purchase-invoice.service';
import { approvePurchaseMaalInvoice } from '../invoices/purchase-maal.service';
import { approveSaleCommissionInvoice } from '../invoices/sale-commission.service';
import { approveSaleInvoice } from '../invoices/sale-invoice.service';
import { approveSalePaunchInvoice } from '../invoices/sale-paunch.service';

export type PendingApprovalItem = {
  kind: 'voucher' | 'invoice';
  id: number;
  type: string;
  reference: string | null;
  date: string | null;
  amount: number;
  description: string | null;
  createdBy: { id: number; displayName: string; username: string } | null;
};

export async function listPendingApprovals(): Promise<PendingApprovalItem[]> {
  const [vouchers, invoices] = await Promise.all([
    prisma.voucher.findMany({
      where: { status: VoucherStatus.PENDING_APPROVAL },
      include: { createdBy: { select: { id: true, displayName: true, username: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invoice.findMany({
      where: { status: InvoiceStatus.PENDING_APPROVAL },
      include: { createdBy: { select: { id: true, displayName: true, username: true } } },
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
    case InvoiceType.SALE_PAUNCH:
      return approveSalePaunchInvoice(invoiceId);
    case InvoiceType.SALE_COMMISSION:
      return approveSaleCommissionInvoice(invoiceId);
    case InvoiceType.PURCHASE_MAAL:
      return approvePurchaseMaalInvoice(invoiceId);
    default:
      throw new AppError(400, `Cannot approve invoice type ${invoice.type}`);
  }
}
