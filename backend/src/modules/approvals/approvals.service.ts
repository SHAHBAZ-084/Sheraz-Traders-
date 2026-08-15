import { InvoiceStatus, InvoiceType, VoucherStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  assertVoucherDateInActiveFinancialYear,
  approveVoucher,
} from '../accounting/accounting.service';
import { parseVoucherDateInput } from '../accounting/ledger-utils';
import { getInvoice } from '../invoices/invoices.service';
import {
  approveKachiMaalInvoice,
  updatePendingKachiMaalInvoice,
} from '../invoices/kachi-maal.service';
import {
  approvePurchaseInvoice,
  updatePendingPurchaseInvoice,
} from '../invoices/purchase-invoice.service';
import {
  approveSaleInvoice,
  updatePendingSaleInvoice,
} from '../invoices/sale-invoice.service';
import { assertCanEditPendingInvoice, assertCanEditPendingVoucher, type PendingEditor } from './pending-edit-auth';

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

export async function getPendingVoucher(voucherId: number, editor: PendingEditor) {
  const voucher = await prisma.voucher.findFirst({
    where: { id: voucherId, status: VoucherStatus.PENDING_APPROVAL },
    include: {
      debitAccount: { select: { id: true, name: true, code: true, categoryId: true } },
      creditAccount: { select: { id: true, name: true, code: true, categoryId: true } },
      createdBy: { select: { id: true, displayName: true, username: true } },
    },
  });
  if (!voucher) throw new AppError(404, 'Pending voucher not found');
  assertCanEditPendingVoucher(editor);
  return {
    id: voucher.id,
    type: voucher.type,
    number: voucher.number,
    date: voucher.date ? voucher.date.toISOString().slice(0, 10) : null,
    debitAccountId: voucher.debitAccountId,
    creditAccountId: voucher.creditAccountId,
    debitAccount: voucher.debitAccount,
    creditAccount: voucher.creditAccount,
    amount: Number(voucher.amount),
    reference: voucher.reference,
    description: voucher.description,
    status: voucher.status,
    createdById: voucher.createdById,
    createdBy: voucher.createdBy
      ? {
          id: voucher.createdBy.id,
          displayName: voucher.createdBy.displayName ?? voucher.createdBy.username,
          username: voucher.createdBy.username,
        }
      : null,
  };
}

export async function updatePendingVoucher(
  voucherId: number,
  editor: PendingEditor,
  data: {
    date: string | Date;
    debitAccountId: number;
    creditAccountId: number;
    amount: number;
    reference: string;
    description?: string | null;
  },
) {
  const existing = await prisma.voucher.findFirst({
    where: { id: voucherId, status: VoucherStatus.PENDING_APPROVAL },
  });
  if (!existing) throw new AppError(404, 'Pending voucher not found');
  assertCanEditPendingVoucher(editor);

  if (data.debitAccountId === data.creditAccountId) {
    throw new AppError(400, 'Debit and credit accounts must be different');
  }
  if (!(Number(data.amount) > 0)) {
    throw new AppError(400, 'Amount must be greater than zero');
  }
  const reference = data.reference.trim();
  if (!reference) throw new AppError(400, 'Reference is required');

  const debit = await prisma.account.findFirst({
    where: { id: data.debitAccountId, isActive: true },
  });
  const credit = await prisma.account.findFirst({
    where: { id: data.creditAccountId, isActive: true },
  });
  if (!debit || !credit) throw new AppError(400, 'Invalid debit or credit account');

  let voucherDate: Date;
  try {
    voucherDate = parseVoucherDateInput(data.date);
  } catch {
    throw new AppError(400, 'Invalid voucher date');
  }

  const financialYearId = await prisma.$transaction(async (tx) =>
    assertVoucherDateInActiveFinancialYear(tx, voucherDate),
  );

  return prisma.voucher.update({
    where: { id: voucherId },
    data: {
      date: voucherDate,
      debitAccountId: data.debitAccountId,
      creditAccountId: data.creditAccountId,
      amount: data.amount,
      reference,
      description: data.description?.trim() || null,
      financialYearId,
      modifiedById: editor.id,
    },
    include: {
      debitAccount: { select: { id: true, name: true, code: true, categoryId: true } },
      creditAccount: { select: { id: true, name: true, code: true, categoryId: true } },
    },
  });
}

export async function getPendingInvoice(invoiceId: number, editor: PendingEditor) {
  const invoice = await getInvoice(invoiceId);
  if (invoice.status !== InvoiceStatus.PENDING_APPROVAL) {
    throw new AppError(400, 'Invoice is not pending approval');
  }
  assertCanEditPendingInvoice(editor, invoice.createdById);
  return invoice;
}

export async function updatePendingInvoice(
  invoiceId: number,
  editor: PendingEditor,
  body: Record<string, unknown>,
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, status: InvoiceStatus.PENDING_APPROVAL },
    select: { id: true, type: true, createdById: true },
  });
  if (!invoice) throw new AppError(404, 'Pending invoice not found');
  assertCanEditPendingInvoice(editor, invoice.createdById);

  switch (invoice.type) {
    case InvoiceType.SALE_INVOICE:
      return updatePendingSaleInvoice(invoiceId, {
        invoiceDate: String(body.invoiceDate),
        billNo: body.billNo as string | undefined,
        notes: body.notes as string | undefined,
        storeId: Number(body.storeId),
        customerAccountId: Number(body.customerAccountId),
        lines: body.lines as Array<{ productId: number; quantity: number; rate: number }>,
      });
    case InvoiceType.PURCHASE_INVOICE:
      return updatePendingPurchaseInvoice(invoiceId, {
        invoiceDate: String(body.invoiceDate),
        billNo: body.billNo as string | undefined,
        notes: body.notes as string | undefined,
        storeId: Number(body.storeId),
        supplierAccountId: Number(body.supplierAccountId),
        lines: body.lines as Array<{
          productId: number;
          quantity: number;
          rate: number;
          mazduriAmount?: number;
        }>,
      });
    case InvoiceType.KACHI_MAAL:
      return updatePendingKachiMaalInvoice(invoiceId, {
        invoiceDate: String(body.invoiceDate),
        billNo: body.billNo as string | undefined,
        gariNo: body.gariNo as string | undefined,
        jins: body.jins as string | undefined,
        qism: body.qism as string | undefined,
        tafseel: body.tafseel as string | undefined,
        debitAccountId: Number(body.debitAccountId),
        miscAmount: body.miscAmount != null ? Number(body.miscAmount) : undefined,
        lines: body.lines as Array<{
          partyAccountId: number;
          jins?: string;
          qism?: string;
          bagCount: number;
          bhartii: number;
          dharanCount: number;
          looseKg: number;
          ratePerMaund: number;
        }>,
      });
    default:
      throw new AppError(400, `Cannot edit invoice type ${invoice.type}`);
  }
}
