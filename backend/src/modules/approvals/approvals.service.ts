import { InvoiceStatus, InvoiceType, RecordStatus, VoucherStatus, VoucherType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  assertVoucherAccountRulesForUpdate,
  assertVoucherDateInActiveFinancialYear,
  approveAccount,
  approveAccountAdjustment,
  approveVoucher,
  rejectAccount,
  rejectAccountAdjustment,
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
import {
  approveProduct,
  approveStockAdjustment,
  rejectProduct,
  rejectStockAdjustment,
} from '../products/products.service';
import {
  formatBankCashAccountLabel,
  recomputeEmbeddedPaymentScalarsInTx,
  recomputeEmbeddedReceiptScalarsInTx,
} from '../invoices/invoice-embedded-voucher';
import { buildPendingInvoiceApprovalDescription } from '../invoices/invoice-voucher-descriptions';
import { assertCanEditPendingInvoice, assertCanEditPendingRecord, assertCanEditPendingVoucher, type PendingEditor } from './pending-edit-auth';

export type PendingApprovalKind =
  | 'voucher'
  | 'invoice'
  | 'account'
  | 'product'
  | 'account_adjustment'
  | 'stock_adjustment';

export type PendingApprovalItem = {
  kind: PendingApprovalKind;
  id: number;
  number: number;
  type: string;
  reference: string | null;
  date: string | null;
  debitAccountName?: string | null;
  creditAccountName?: string | null;
  /** Primary account for “View Ledger” (party / maal khata / new account / adjusted account). */
  ledgerAccountId?: number | null;
  amount: number;
  /** When set (e.g. Kachi Maal), Pending Approval shows separate Credit/Debit amount columns. */
  creditAmount?: number | null;
  debitAmount?: number | null;
  description: string | null;
  createdBy: { id: number; displayName: string; username: string } | null;
};

function displayNumberFromReference(reference: string | null | undefined, fallbackId: number) {
  if (reference) {
    const match = reference.match(/(\d+)\s*$/);
    if (match) return parseInt(match[1], 10);
  }
  return fallbackId;
}

function formatKachiUpperPartyLabel(names: string[]): string | null {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];
  if (unique.length <= 3) return unique.join(', ');
  return `${unique[0]} and ${unique.length - 1} others`;
}

function mapCreatedBy(user: { id: number; displayName: string | null; username: string } | null) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.displayName ?? user.username,
    username: user.username,
  };
}

export async function listPendingApprovals(): Promise<PendingApprovalItem[]> {
  const [vouchers, invoices, accounts, products, adjustments] = await Promise.all([
    prisma.voucher.findMany({
      where: { status: VoucherStatus.PENDING_APPROVAL },
      include: {
        createdBy: { select: { id: true, displayName: true, username: true } },
        debitAccount: { select: { id: true, name: true, code: true } },
        creditAccount: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invoice.findMany({
      where: { status: InvoiceStatus.PENDING_APPROVAL },
      include: {
        createdBy: { select: { id: true, displayName: true, username: true } },
        debitAccount: { select: { id: true, name: true, code: true } },
        customer: { select: { name: true } },
        supplier: { select: { name: true } },
        items: {
          orderBy: { id: 'asc' },
          include: { product: { select: { name: true } } },
        },
        kachiMaalLines: {
          orderBy: { sortOrder: 'asc' },
          include: { partyAccount: { select: { id: true, name: true, code: true } } },
        },
        embeddedReceiptAccount: { include: { category: { select: { name: true } } } },
        embeddedPaymentAccount: { include: { category: { select: { name: true } } } },
        vouchers: {
          include: {
            voucher: {
              include: {
                debitAccount: { include: { category: { select: { name: true } } } },
                creditAccount: { include: { category: { select: { name: true } } } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.account.findMany({
      where: { status: RecordStatus.PENDING_APPROVAL, product: null },
      include: {
        createdBy: { select: { id: true, displayName: true, username: true } },
        category: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.product.findMany({
      where: { status: RecordStatus.PENDING_APPROVAL },
      include: {
        createdBy: { select: { id: true, displayName: true, username: true } },
        category: { select: { name: true } },
        account: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.pendingAdjustment.findMany({
      where: { status: RecordStatus.PENDING_APPROVAL },
      include: {
        createdBy: { select: { id: true, displayName: true, username: true } },
        account: { select: { id: true, name: true, code: true, categoryId: true } },
        product: { select: { name: true, code: true, unit: true, accountId: true } },
        store: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const embeddedLineAccountIds = new Set<number>();
  for (const inv of invoices) {
    for (const raw of [inv.embeddedReceiptLines, inv.embeddedPaymentLines]) {
      if (!Array.isArray(raw)) continue;
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const id = Number((item as { accountId?: unknown }).accountId);
        if (id > 0) embeddedLineAccountIds.add(id);
      }
    }
  }
  const embeddedLineAccounts =
    embeddedLineAccountIds.size > 0
      ? await prisma.account.findMany({
          where: { id: { in: [...embeddedLineAccountIds] } },
          include: { category: { select: { name: true } } },
        })
      : [];
  const embeddedLineAccountLabelsGlobal: Record<number, string> = {};
  for (const account of embeddedLineAccounts) {
    embeddedLineAccountLabelsGlobal[account.id] = formatBankCashAccountLabel(
      account.category?.name ?? '',
      account.name,
    );
  }

  const items: PendingApprovalItem[] = [
    ...vouchers.map((v) => ({
      kind: 'voucher' as const,
      id: v.id,
      number: v.number,
      type: v.type,
      reference: v.reference,
      date: v.date?.toISOString() ?? null,
      debitAccountName: v.debitAccount ? `${v.debitAccount.name} (${v.debitAccount.code})` : null,
      creditAccountName: v.creditAccount ? `${v.creditAccount.name} (${v.creditAccount.code})` : null,
      ledgerAccountId: v.debitAccount?.id ?? v.creditAccount?.id ?? null,
      amount: Number(v.amount),
      description: v.description,
      createdBy: mapCreatedBy(v.createdBy),
    })),
    ...invoices.map((inv) => {
      // Invoice.debitAccountId stores "the party" for Sale/Purchase, but Kachi Maal is special:
      // debit = settlement/"lower party"; credits = upper-party sellers (net of Pale Dari/Brokery).
      const isPurchase = inv.type === InvoiceType.PURCHASE_INVOICE;
      const isKachi = inv.type === InvoiceType.KACHI_MAAL;

      let debitAccountName: string | null;
      let creditAccountName: string | null;
      let creditAmount: number | null = null;
      let debitAmount: number | null = null;
      let ledgerAccountId: number | null = inv.debitAccount?.id ?? inv.debitAccountId ?? null;
      const amount = Number(inv.total);

      if (isKachi) {
        const lowerPartyName = inv.debitAccount?.name ?? null;
        const upperPartyNames = (inv.kachiMaalLines ?? []).map(
          (line) => line.partyAccount?.name ?? '',
        );
        debitAccountName = lowerPartyName;
        creditAccountName = formatKachiUpperPartyLabel(upperPartyNames);
        debitAmount = amount;
        creditAmount = (inv.kachiMaalLines ?? []).reduce(
          (sum, line) => sum + Number(line.netCreditToParty ?? 0),
          0,
        );
        creditAmount = Math.round(creditAmount * 100) / 100;
        ledgerAccountId = inv.debitAccount?.id ?? inv.debitAccountId ?? null;
      } else {
        const partyName = isPurchase
          ? (inv.debitAccount?.name ?? inv.supplier?.name ?? null)
          : (inv.debitAccount?.name ?? inv.customer?.name ?? null);
        debitAccountName = isPurchase ? null : partyName;
        creditAccountName = isPurchase ? partyName : null;
      }

      const embeddedLineAccountLabels: Record<number, string> = { ...embeddedLineAccountLabelsGlobal };
      if (inv.embeddedReceiptAccount && inv.embeddedReceiptAccountId != null) {
        embeddedLineAccountLabels[inv.embeddedReceiptAccountId] = formatBankCashAccountLabel(
          inv.embeddedReceiptAccount.category?.name ?? '',
          inv.embeddedReceiptAccount.name,
        );
      }
      if (inv.embeddedPaymentAccount && inv.embeddedPaymentAccountId != null) {
        embeddedLineAccountLabels[inv.embeddedPaymentAccountId] = formatBankCashAccountLabel(
          inv.embeddedPaymentAccount.category?.name ?? '',
          inv.embeddedPaymentAccount.name,
        );
      }

      return {
        kind: 'invoice' as const,
        id: inv.id,
        number: displayNumberFromReference(inv.reference, inv.id),
        type: inv.type,
        reference: inv.reference,
        date: inv.invoiceDate?.toISOString() ?? null,
        debitAccountName,
        creditAccountName,
        ledgerAccountId,
        amount,
        creditAmount,
        debitAmount,
        description: buildPendingInvoiceApprovalDescription({
          type: inv.type,
          notes: inv.notes,
          billNo: inv.billNo,
          jins: inv.jins,
          tafseel: inv.tafseel,
          gariNo: inv.gariNo,
          items: inv.items,
          kachiMaalLines: inv.kachiMaalLines,
          embeddedReceiptAmount:
            inv.embeddedReceiptAmount != null ? Number(inv.embeddedReceiptAmount) : null,
          embeddedPaymentAmount:
            inv.embeddedPaymentAmount != null ? Number(inv.embeddedPaymentAmount) : null,
          embeddedReceiptAccount: inv.embeddedReceiptAccount,
          embeddedPaymentAccount: inv.embeddedPaymentAccount,
          embeddedReceiptLines: inv.embeddedReceiptLines,
          embeddedPaymentLines: inv.embeddedPaymentLines,
          embeddedLineAccountLabels,
          vouchers: inv.vouchers,
        }),
        createdBy: mapCreatedBy(inv.createdBy),
      };
    }),
    ...accounts.map((account) => {
      const opening = Math.abs(Number(account.pendingOpeningBalance ?? 0));
      const side = account.pendingOpeningSide === 'CR' ? 'Cr' : 'Dr';
      return {
        kind: 'account' as const,
        id: account.id,
        number: account.id,
        type: 'ACCOUNT',
        reference: account.code,
        date: account.createdAt.toISOString(),
        debitAccountName: account.name,
        creditAccountName: account.category?.name ?? null,
        ledgerAccountId: account.id,
        amount: opening,
        description: opening > 0 ? `Opening ${opening.toFixed(2)} ${side}` : 'No opening balance',
        createdBy: mapCreatedBy(account.createdBy),
      };
    }),
    ...products.map((product) => {
      const qty = Number(product.pendingOpeningQty ?? 0);
      const rate = Number(product.pendingOpeningRate ?? 0);
      const openingValue = qty > 0 && rate > 0 ? qty * rate : 0;
      const kachi = product.pendingKachiOpening;
      const kachiHint =
        kachi && typeof kachi === 'object' && kachi !== null && 'ratePerMaund' in kachi
          ? `Kachi opening @ ${Number((kachi as { ratePerMaund?: number }).ratePerMaund) || 0}/maund`
          : null;
      const openingHint =
        qty > 0
          ? `Opening ${qty}${product.unit ? ` ${product.unit}` : ''} @ ${rate}`
          : kachiHint;
      return {
        kind: 'product' as const,
        id: product.id,
        number: product.id,
        type: product.kind,
        reference: product.code,
        date: product.createdAt.toISOString(),
        debitAccountName: product.name,
        creditAccountName: product.category?.name ?? null,
        ledgerAccountId: product.account?.id ?? product.accountId ?? null,
        amount: openingValue,
        description: [openingHint, product.unit ? `Unit ${product.unit}` : null].filter(Boolean).join(' · ') || null,
        createdBy: mapCreatedBy(product.createdBy),
      };
    }),
    ...adjustments.map((row) => {
      if (row.kind === 'ACCOUNT') {
        const side = row.side === 'CR' ? 'Cr' : 'Dr';
        return {
          kind: 'account_adjustment' as const,
          id: row.id,
          number: row.id,
          type: 'ACCOUNT_ADJUSTMENT',
          reference: row.account ? `${row.account.name} (${row.account.code})` : null,
          date: row.adjustmentDate.toISOString(),
          debitAccountName: row.side === 'DR' ? row.account?.name ?? null : 'Opening Balance Equity',
          creditAccountName: row.side === 'CR' ? row.account?.name ?? null : 'Opening Balance Equity',
          ledgerAccountId: row.account?.id ?? row.accountId ?? null,
          amount: Number(row.amount ?? 0),
          description: `Account adjustment ${side}`,
          createdBy: mapCreatedBy(row.createdBy),
        };
      }
      const qty = Number(row.quantity ?? 0);
      const rate = Number(row.rate ?? 0);
      return {
        kind: 'stock_adjustment' as const,
        id: row.id,
        number: row.id,
        type: 'STOCK_ADJUSTMENT',
        reference: row.product ? `${row.product.code} — ${row.product.name}` : null,
        date: row.adjustmentDate.toISOString(),
        debitAccountName: row.product?.name ?? null,
        creditAccountName: row.store?.name ?? null,
        ledgerAccountId: row.product?.accountId ?? null,
        amount: qty > 0 && rate > 0 ? qty * rate : Number(row.amount ?? 0),
        description:
          qty > 0
            ? `Qty ${qty}${row.product?.unit ? ` ${row.product.unit}` : ''}${rate > 0 ? ` @ ${rate}` : ''}`
            : 'Kachi stock adjustment',
        createdBy: mapCreatedBy(row.createdBy),
      };
    }),
  ];

  return items.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
}

export async function approvePendingVoucher(voucherId: number, approvedById: number) {
  return approveVoucher(voucherId, approvedById);
}

export async function rejectPendingVoucher(voucherId: number) {
  const voucher = await prisma.voucher.findFirst({
    where: { id: voucherId, status: VoucherStatus.PENDING_APPROVAL },
    include: { invoiceLink: true },
  });
  if (!voucher) throw new AppError(404, 'Pending voucher not found');

  await prisma.$transaction(async (tx) => {
    if (voucher.invoiceLink) {
      await tx.invoiceVoucher.delete({ where: { id: voucher.invoiceLink.id } });
      if (voucher.type === VoucherType.SALE_RECEIPT) {
        await recomputeEmbeddedReceiptScalarsInTx(tx, voucher.invoiceLink.invoiceId);
      } else if (voucher.type === VoucherType.PURCHASE_PAYMENT) {
        await recomputeEmbeddedPaymentScalarsInTx(tx, voucher.invoiceLink.invoiceId);
      }
    }
    await tx.voucher.delete({ where: { id: voucherId } });
  });

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

export async function approvePendingAccount(accountId: number, approvedById: number) {
  return approveAccount(accountId, approvedById);
}

export async function rejectPendingAccount(accountId: number) {
  return rejectAccount(accountId);
}

export async function approvePendingProduct(productId: number, approvedById: number) {
  return approveProduct(productId, approvedById);
}

export async function rejectPendingProduct(productId: number) {
  return rejectProduct(productId);
}

export async function approvePendingAccountAdjustment(id: number, approvedById: number) {
  return approveAccountAdjustment(id, approvedById);
}

export async function rejectPendingAccountAdjustment(id: number) {
  return rejectAccountAdjustment(id);
}

export async function approvePendingStockAdjustment(id: number, approvedById: number) {
  return approveStockAdjustment(id, approvedById);
}

export async function rejectPendingStockAdjustment(id: number) {
  return rejectStockAdjustment(id);
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
  assertCanEditPendingVoucher(editor, voucher.createdById);
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
  assertCanEditPendingVoucher(editor, existing.createdById);

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
    include: { category: true },
  });
  const credit = await prisma.account.findFirst({
    where: { id: data.creditAccountId, isActive: true },
    include: { category: true },
  });
  if (!debit || !credit) throw new AppError(400, 'Invalid debit or credit account');

  if (
    existing.type === VoucherType.RECEIPT
    || existing.type === VoucherType.SALE_RECEIPT
    || existing.type === VoucherType.PAYMENT
    || existing.type === VoucherType.PURCHASE_PAYMENT
  ) {
    assertVoucherAccountRulesForUpdate(existing.type, debit, credit);
  }

  let voucherDate: Date;
  try {
    voucherDate = parseVoucherDateInput(data.date);
  } catch {
    throw new AppError(400, 'Invalid voucher date');
  }

  const financialYearId = await prisma.$transaction(async (tx) =>
    assertVoucherDateInActiveFinancialYear(tx, voucherDate),
  );

  const updated = await prisma.voucher.update({
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

  const invoiceLink = await prisma.invoiceVoucher.findFirst({ where: { voucherId } });
  if (invoiceLink) {
    await prisma.$transaction(async (tx) => {
      if (existing.type === VoucherType.SALE_RECEIPT) {
        await recomputeEmbeddedReceiptScalarsInTx(tx, invoiceLink.invoiceId);
      } else if (existing.type === VoucherType.PURCHASE_PAYMENT) {
        await recomputeEmbeddedPaymentScalarsInTx(tx, invoiceLink.invoiceId);
      }
    });
  }

  return updated;
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
        receipts: Array.isArray(body.receipts)
          ? (body.receipts as Array<{ amount: number; accountId: number }>)
          : undefined,
        receiptAmount: body.receiptAmount != null ? Number(body.receiptAmount) : undefined,
        receiptAccountId: body.receiptAccountId != null ? Number(body.receiptAccountId) : undefined,
        lines: body.lines as Array<{ productId: number; quantity: number; rate: number }>,
      });
    case InvoiceType.PURCHASE_INVOICE:
      return updatePendingPurchaseInvoice(invoiceId, {
        invoiceDate: String(body.invoiceDate),
        billNo: body.billNo as string | undefined,
        notes: body.notes as string | undefined,
        storeId: Number(body.storeId),
        supplierAccountId: Number(body.supplierAccountId),
        payments: Array.isArray(body.payments)
          ? (body.payments as Array<{ amount: number; accountId: number }>)
          : undefined,
        paymentAmount: body.paymentAmount != null ? Number(body.paymentAmount) : undefined,
        paymentAccountId: body.paymentAccountId != null ? Number(body.paymentAccountId) : undefined,
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

export async function getPendingAccount(accountId: number, editor: PendingEditor) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, status: RecordStatus.PENDING_APPROVAL, product: null },
    include: {
      category: { select: { id: true, name: true } },
      createdBy: { select: { id: true, displayName: true, username: true } },
    },
  });
  if (!account) throw new AppError(404, 'Pending account not found');
  assertCanEditPendingRecord(editor, account.createdById, 'pending accounts');
  return {
    id: account.id,
    name: account.name,
    code: account.code,
    categoryId: account.categoryId,
    category: account.category,
    pendingOpeningBalance:
      account.pendingOpeningBalance != null ? Number(account.pendingOpeningBalance) : null,
    pendingOpeningSide: account.pendingOpeningSide === 'CR' ? ('CR' as const) : account.pendingOpeningSide === 'DR' ? ('DR' as const) : null,
    status: account.status,
    createdById: account.createdById,
  };
}

export async function updatePendingAccount(
  accountId: number,
  editor: PendingEditor,
  data: {
    name: string;
    categoryId: number;
    openingBalance?: number;
    openingBalanceSide?: 'DR' | 'CR';
  },
) {
  const existing = await prisma.account.findFirst({
    where: { id: accountId, status: RecordStatus.PENDING_APPROVAL, product: null },
  });
  if (!existing) throw new AppError(404, 'Pending account not found');
  assertCanEditPendingRecord(editor, existing.createdById, 'pending accounts');

  const name = data.name.trim();
  if (!name) throw new AppError(400, 'Account name is required');

  const category = await prisma.accountCategory.findFirst({
    where: { id: data.categoryId, isActive: true },
  });
  if (!category) throw new AppError(400, 'Invalid category');

  const amount = Math.abs(data.openingBalance ?? 0);
  const side = data.openingBalanceSide ?? 'DR';

  return prisma.account.update({
    where: { id: accountId },
    data: {
      name,
      categoryId: data.categoryId,
      pendingOpeningBalance: amount > 0 ? amount : null,
      pendingOpeningSide: amount > 0 ? side : null,
      status: RecordStatus.PENDING_APPROVAL,
    },
    include: { category: true, ledger: true },
  });
}

export async function getPendingProduct(productId: number, editor: PendingEditor) {
  const product = await prisma.product.findFirst({
    where: { id: productId, status: RecordStatus.PENDING_APPROVAL },
    include: {
      category: { select: { id: true, name: true } },
      account: { select: { id: true, name: true, code: true } },
      createdBy: { select: { id: true, displayName: true, username: true } },
    },
  });
  if (!product) throw new AppError(404, 'Pending product not found');
  assertCanEditPendingRecord(editor, product.createdById, 'pending products');
  return {
    id: product.id,
    name: product.name,
    code: product.code,
    unit: product.unit,
    kind: product.kind,
    categoryId: product.categoryId,
    category: product.category,
    accountId: product.accountId,
    account: product.account,
    pendingOpeningStoreId: product.pendingOpeningStoreId,
    pendingOpeningQty:
      product.pendingOpeningQty != null ? Number(product.pendingOpeningQty) : null,
    pendingOpeningRate:
      product.pendingOpeningRate != null ? Number(product.pendingOpeningRate) : null,
    pendingKachiOpening: product.pendingKachiOpening,
    status: product.status,
    createdById: product.createdById,
  };
}

export async function updatePendingProduct(
  productId: number,
  editor: PendingEditor,
  data: {
    name: string;
    unit?: string | null;
    categoryId?: number | null;
    openingStock?: number;
    openingStockRate?: number;
    openingStoreId?: number | null;
    kachiOpening?: Record<string, unknown> | null;
  },
) {
  const existing = await prisma.product.findFirst({
    where: { id: productId, status: RecordStatus.PENDING_APPROVAL },
  });
  if (!existing) throw new AppError(404, 'Pending product not found');
  assertCanEditPendingRecord(editor, existing.createdById, 'pending products');

  const name = data.name.trim();
  if (!name) throw new AppError(400, 'Product name is required');

  if (data.categoryId != null) {
    const cat = await prisma.productCategory.findFirst({ where: { id: data.categoryId } });
    if (!cat) throw new AppError(400, 'Invalid product category');
  }

  const isKachi = existing.kind === 'KACHI';
  let pendingOpeningStoreId: number | null = null;
  let pendingOpeningQty: number | null = null;
  let pendingOpeningRate: number | null = null;
  let pendingKachiOpening: object | null = null;

  if (isKachi) {
    pendingKachiOpening =
      data.kachiOpening && typeof data.kachiOpening === 'object' ? data.kachiOpening : null;
    pendingOpeningStoreId = data.openingStoreId ?? null;
  } else {
    const qty = data.openingStock != null ? Number(data.openingStock) : 0;
    const rate = data.openingStockRate != null ? Number(data.openingStockRate) : 0;
    if (qty > 0) {
      if (!(rate > 0)) throw new AppError(400, 'Opening stock rate is required when quantity is set');
      if (data.openingStoreId == null) throw new AppError(400, 'Opening store is required when quantity is set');
      pendingOpeningQty = qty;
      pendingOpeningRate = rate;
      pendingOpeningStoreId = data.openingStoreId;
    }
  }

  return prisma.product.update({
    where: { id: productId },
    data: {
      name,
      unit: data.unit?.trim() || null,
      categoryId: data.categoryId ?? null,
      pendingOpeningStoreId,
      pendingOpeningQty,
      pendingOpeningRate,
      pendingKachiOpening: pendingKachiOpening as object | undefined,
      status: RecordStatus.PENDING_APPROVAL,
    },
    include: { category: true, account: true },
  });
}

export async function getPendingAccountAdjustment(id: number, editor: PendingEditor) {
  const row = await prisma.pendingAdjustment.findFirst({
    where: { id, kind: 'ACCOUNT', status: RecordStatus.PENDING_APPROVAL },
    include: {
      account: { select: { id: true, name: true, code: true, categoryId: true } },
      createdBy: { select: { id: true, displayName: true, username: true } },
    },
  });
  if (!row) throw new AppError(404, 'Pending account adjustment not found');
  assertCanEditPendingRecord(editor, row.createdById, 'pending adjustments');
  return {
    id: row.id,
    kind: row.kind,
    adjustmentDate: row.adjustmentDate.toISOString(),
    accountId: row.accountId,
    account: row.account,
    amount: Number(row.amount ?? 0),
    side: row.side === 'CR' ? ('CR' as const) : ('DR' as const),
    description: row.description,
    status: row.status,
    createdById: row.createdById,
  };
}

export async function updatePendingAccountAdjustment(
  id: number,
  editor: PendingEditor,
  data: {
    adjustmentDate: string;
    accountId: number;
    amount: number;
    side: 'DR' | 'CR';
    description?: string | null;
  },
) {
  const existing = await prisma.pendingAdjustment.findFirst({
    where: { id, kind: 'ACCOUNT', status: RecordStatus.PENDING_APPROVAL },
  });
  if (!existing) throw new AppError(404, 'Pending account adjustment not found');
  assertCanEditPendingRecord(editor, existing.createdById, 'pending adjustments');

  let adjustmentDate: Date;
  try {
    adjustmentDate = parseVoucherDateInput(data.adjustmentDate);
  } catch {
    throw new AppError(400, 'Invalid adjustment date');
  }
  await assertVoucherDateInActiveFinancialYear(prisma, adjustmentDate, 'Invoice');

  const account = await prisma.account.findFirst({
    where: { id: data.accountId, status: RecordStatus.ACTIVE, isActive: true },
    include: { category: true },
  });
  if (!account) throw new AppError(404, 'Account not found');

  const amount = Math.abs(Number(data.amount));
  if (!(amount > 0)) throw new AppError(400, 'Amount must be greater than zero');
  if (data.side !== 'DR' && data.side !== 'CR') throw new AppError(400, 'Side must be DR or CR');

  return prisma.pendingAdjustment.update({
    where: { id },
    data: {
      adjustmentDate,
      accountId: data.accountId,
      amount,
      side: data.side,
      description: data.description?.trim() || null,
      status: RecordStatus.PENDING_APPROVAL,
    },
    include: { account: true },
  });
}

export async function getPendingStockAdjustment(id: number, editor: PendingEditor) {
  const row = await prisma.pendingAdjustment.findFirst({
    where: { id, kind: 'STOCK', status: RecordStatus.PENDING_APPROVAL },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          code: true,
          unit: true,
          kind: true,
          categoryId: true,
          accountId: true,
        },
      },
      store: { select: { id: true, name: true } },
      createdBy: { select: { id: true, displayName: true, username: true } },
    },
  });
  if (!row) throw new AppError(404, 'Pending stock adjustment not found');
  assertCanEditPendingRecord(editor, row.createdById, 'pending adjustments');
  return {
    id: row.id,
    kind: row.kind,
    adjustmentDate: row.adjustmentDate.toISOString(),
    productId: row.productId,
    product: row.product,
    storeId: row.storeId,
    store: row.store,
    quantity: row.quantity != null ? Number(row.quantity) : null,
    rate: row.rate != null ? Number(row.rate) : null,
    kachiOpening: row.kachiOpening,
    description: row.description,
    status: row.status,
    createdById: row.createdById,
  };
}

export async function updatePendingStockAdjustment(
  id: number,
  editor: PendingEditor,
  data: {
    adjustmentDate: string;
    productId: number;
    storeId: number;
    quantity?: number;
    rate?: number;
    kachiOpening?: Record<string, unknown> | null;
    description?: string | null;
  },
) {
  const existing = await prisma.pendingAdjustment.findFirst({
    where: { id, kind: 'STOCK', status: RecordStatus.PENDING_APPROVAL },
  });
  if (!existing) throw new AppError(404, 'Pending stock adjustment not found');
  assertCanEditPendingRecord(editor, existing.createdById, 'pending adjustments');

  let adjustmentDate: Date;
  try {
    adjustmentDate = parseVoucherDateInput(data.adjustmentDate);
  } catch {
    throw new AppError(400, 'Invalid adjustment date');
  }
  await assertVoucherDateInActiveFinancialYear(prisma, adjustmentDate, 'Invoice');

  const product = await prisma.product.findFirst({
    where: { id: data.productId, status: RecordStatus.ACTIVE, isActive: true },
  });
  if (!product) throw new AppError(404, 'Product not found');

  const store = await prisma.store.findFirst({ where: { id: data.storeId, isActive: true } });
  if (!store) throw new AppError(404, 'Store not found');

  let quantity: number | null = null;
  let rate: number | null = null;
  let kachiOpening: object | null = null;

  if (product.kind === 'KACHI') {
    if (!data.kachiOpening || typeof data.kachiOpening !== 'object') {
      throw new AppError(400, 'Kachi opening fields are required');
    }
    kachiOpening = data.kachiOpening;
  } else {
    const qty = Number(data.quantity);
    const unitRate = Number(data.rate);
    if (!(qty > 0)) throw new AppError(400, 'Quantity must be greater than zero');
    if (!(unitRate > 0)) throw new AppError(400, 'Rate must be greater than zero');
    quantity = qty;
    rate = unitRate;
  }

  return prisma.pendingAdjustment.update({
    where: { id },
    data: {
      adjustmentDate,
      productId: data.productId,
      storeId: data.storeId,
      quantity,
      rate,
      kachiOpening: kachiOpening as object | undefined,
      description: data.description?.trim() || null,
      status: RecordStatus.PENDING_APPROVAL,
    },
    include: { product: true, store: true },
  });
}
