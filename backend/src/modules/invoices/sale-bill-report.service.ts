import { InvoiceStatus, InvoiceType, VoucherStatus, VoucherType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { getActiveFinancialYearId } from '../accounting/accounting.service';
import { formatBankCashAccountLabel } from './invoice-embedded-voucher';
import { roundMoney } from './sale-invoice.calculations';

function parseDateStart(value: string) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDateEnd(value: string) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

export type SaleBillLineItem = {
  productName: string;
  price: number;
  amount: number;
};

export type SaleBillInvoiceGroup = {
  invoiceId: number;
  invoiceReference: string;
  invoiceDate: string;
  partyName: string;
  partyAccountId: number;
  lines: SaleBillLineItem[];
  receivedAmount: number;
  receivedAccountLabel: string | null;
  receivedPending: boolean;
  netTotal: number;
};

export type SaleBillSummaryResult = {
  fromDate: string;
  toDate: string;
  grandTotal: number;
  receivedTotal: number;
  remainingTotal: number;
  invoices: SaleBillInvoiceGroup[];
};

function isoDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function getSaleBillSummary(options: {
  fromDate: string;
  toDate: string;
  partyAccountId?: number;
  financialYearId?: number;
}): Promise<SaleBillSummaryResult> {
  const from = parseDateStart(options.fromDate);
  const to = parseDateEnd(options.toDate);
  if (from > to) throw new AppError(400, 'From date must be on or before to date');

  const financialYearId =
    options.financialYearId ?? (await getActiveFinancialYearId(prisma));

  const invoices = await prisma.invoice.findMany({
    where: {
      type: InvoiceType.SALE_INVOICE,
      status: InvoiceStatus.POSTED,
      financialYearId,
      invoiceDate: { gte: from, lte: to },
      ...(options.partyAccountId != null ? { debitAccountId: options.partyAccountId } : {}),
    },
    include: {
      debitAccount: { select: { id: true, name: true } },
      items: {
        orderBy: { id: 'asc' },
        include: { product: { select: { name: true } } },
      },
      embeddedReceiptAccount: {
        include: { category: { select: { name: true } } },
      },
      vouchers: {
        include: {
          voucher: {
            include: {
              debitAccount: { include: { category: { select: { name: true } } } },
            },
          },
        },
      },
    },
    orderBy: [{ debitAccountId: 'asc' }, { invoiceDate: 'asc' }, { id: 'asc' }],
  });

  const groups: SaleBillInvoiceGroup[] = invoices.map((invoice) => {
    const partyName = invoice.debitAccount?.name ?? 'Unknown party';
    const netTotal = roundMoney(Number(invoice.total));

    const postedReceipt = invoice.vouchers.find(
      (link) =>
        link.voucher.type === VoucherType.SALE_RECEIPT
        && link.voucher.status === VoucherStatus.ACTIVE,
    )?.voucher;

    const pendingReceipt = invoice.vouchers.find(
      (link) =>
        link.voucher.type === VoucherType.SALE_RECEIPT
        && link.voucher.status === VoucherStatus.PENDING_APPROVAL,
    )?.voucher;

    let receivedAmount = 0;
    let receivedAccountLabel: string | null = null;
    let receivedPending = false;

    if (postedReceipt?.debitAccount) {
      receivedAmount = roundMoney(Number(postedReceipt.amount));
      receivedAccountLabel = formatBankCashAccountLabel(
        postedReceipt.debitAccount.category.name,
        postedReceipt.debitAccount.name,
      );
    } else if (pendingReceipt?.debitAccount) {
      receivedPending = true;
      receivedAccountLabel = formatBankCashAccountLabel(
        pendingReceipt.debitAccount.category.name,
        pendingReceipt.debitAccount.name,
      );
    } else if (
      invoice.embeddedReceiptAmount != null
      && Number(invoice.embeddedReceiptAmount) > 0
      && invoice.embeddedReceiptAccount
    ) {
      receivedAccountLabel = formatBankCashAccountLabel(
        invoice.embeddedReceiptAccount.category.name,
        invoice.embeddedReceiptAccount.name,
      );
    }

    return {
      invoiceId: invoice.id,
      invoiceReference: invoice.reference,
      invoiceDate: invoice.invoiceDate ? isoDateOnly(invoice.invoiceDate) : '',
      partyName,
      partyAccountId: invoice.debitAccountId ?? 0,
      lines: invoice.items.map((item) => ({
        productName: item.product?.name ?? item.label,
        price: Number(item.unitPrice),
        amount: roundMoney(Number(item.total)),
      })),
      receivedAmount,
      receivedAccountLabel,
      receivedPending,
      netTotal,
    };
  });

  const grandTotal = roundMoney(groups.reduce((sum, g) => sum + g.netTotal, 0));
  const receivedTotal = roundMoney(groups.reduce((sum, g) => sum + g.receivedAmount, 0));
  const remainingTotal = roundMoney(grandTotal - receivedTotal);

  return {
    fromDate: options.fromDate,
    toDate: options.toDate,
    grandTotal,
    receivedTotal,
    remainingTotal,
    invoices: groups,
  };
}
