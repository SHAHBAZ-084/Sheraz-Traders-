import {
  InvoiceStatus,
  InvoiceType,
  LedgerEntryType,
  Prisma,
  VoucherStatus,
  VoucherType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { getActiveFinancialYearId } from '../accounting/accounting.service';
import { endOfDay, startOfDay } from '../accounting/ledger-utils';
import { formatBankCashAccountLabel } from '../invoices/invoice-embedded-voucher';
import {
  formatInvoiceProductLinesDescription,
  formatKachiMaalProductLinesDescription,
} from '../invoices/invoice-voucher-descriptions';
import { roundMoney } from '../invoices/sale-invoice.calculations';

const DAILY_VOUCHER_TYPES: VoucherType[] = [
  VoucherType.PAYMENT,
  VoucherType.RECEIPT,
  VoucherType.JOURNAL,
];

const DAILY_INVOICE_TYPES: InvoiceType[] = [
  InvoiceType.SALE_INVOICE,
  InvoiceType.PURCHASE_INVOICE,
  InvoiceType.KACHI_MAAL,
];

export type DailyActivityVoucherRow = {
  id: number;
  number: number;
  type: VoucherType;
  debitAccountName: string | null;
  creditAccountName: string | null;
  description: string | null;
  amount: number;
  reference: string | null;
};

export type DailyActivityInvoiceRow = {
  id: number;
  type: InvoiceType;
  reference: string;
  debitAccountName: string | null;
  creditAccountName: string | null;
  description: string | null;
  amount: number;
  /** e.g. "Received 20,000 via Cash — Cash in Hand + 15,000 via Bank — HBL" */
  paymentDetail: string | null;
  /** Purchase Mazduri total when present */
  mazduriDetail: string | null;
  /** Sale tax total when present */
  taxDetail: string | null;
};

export type DailyActivityReport = {
  date: string;
  financialYearId: number;
  vouchers: {
    items: DailyActivityVoucherRow[];
    total: number;
    totalAmount: number;
  };
  invoices: {
    items: DailyActivityInvoiceRow[];
    total: number;
    totalAmount: number;
  };
};

function formatMoney(amount: number) {
  const n = roundMoney(amount);
  if (Math.abs(n - Math.round(n)) < 1e-9) {
    return Math.round(n).toLocaleString('en-PK');
  }
  return n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function uniqueJoin(names: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.length > 0 ? out.join(', ') : null;
}

function isPaymentLegNote(notes: string | null | undefined) {
  const n = notes?.trim() ?? '';
  return n.startsWith('Receipt against Invoice') || n.startsWith('Payment against Invoice');
}

async function buildPaymentDetailFromLegs(
  entries: Array<{
    type: LedgerEntryType;
    amount: Prisma.Decimal | number;
    notes: string | null;
    ledger: { account: { name: string; category: { name: string } | null } };
  }>,
  invoiceType: InvoiceType,
): Promise<string | null> {
  const cashBankLegs = entries.filter((e) => {
    if (!isPaymentLegNote(e.notes)) return false;
    if (invoiceType === InvoiceType.SALE_INVOICE) return e.type === LedgerEntryType.DEBIT;
    if (invoiceType === InvoiceType.PURCHASE_INVOICE) return e.type === LedgerEntryType.CREDIT;
    return false;
  });
  if (cashBankLegs.length === 0) return null;

  const parts = cashBankLegs.map((leg) => {
    const label = formatBankCashAccountLabel(
      leg.ledger.account.category?.name ?? '',
      leg.ledger.account.name,
    );
    return `${formatMoney(Number(leg.amount))} via ${label}`;
  });

  const prefix = invoiceType === InvoiceType.PURCHASE_INVOICE ? 'Paid' : 'Received';
  return `${prefix} ${parts.join(' + ')}`;
}

function parseVoucherTypeFilter(value: string | undefined): VoucherType | undefined {
  if (!value) return undefined;
  const upper = value.trim().toUpperCase();
  if (upper === VoucherType.PAYMENT || upper === VoucherType.RECEIPT || upper === VoucherType.JOURNAL) {
    return upper;
  }
  return undefined;
}

export async function getDailyActivityReport(params: {
  date: string;
  financialYearId?: number;
  voucherType?: string;
  productCategoryId?: number;
  voucherLimit?: number;
  voucherOffset?: number;
  invoiceLimit?: number;
  invoiceOffset?: number;
}): Promise<DailyActivityReport> {
  const day = new Date(params.date);
  if (Number.isNaN(day.getTime())) throw new AppError(400, 'Invalid date');

  const from = startOfDay(day);
  const to = endOfDay(day);

  // Daily Report is scoped to the active financial year only (no closed-year lookup).
  const financialYearId = await getActiveFinancialYearId(prisma);
  if (params.financialYearId != null && params.financialYearId !== financialYearId) {
    throw new AppError(400, 'No data — outside the current financial year');
  }

  const year = await prisma.financialYear.findFirst({
    where: { id: financialYearId },
    select: { startDate: true, endDate: true },
  });
  if (!year) throw new AppError(400, 'No active financial year');

  const yearStart = startOfDay(year.startDate);
  if (from < yearStart) {
    throw new AppError(400, 'No data — outside the current financial year');
  }
  if (year.endDate) {
    const yearEnd = endOfDay(year.endDate);
    if (from > yearEnd) {
      throw new AppError(400, 'No data — outside the current financial year');
    }
  }

  const voucherTypeFilter = parseVoucherTypeFilter(params.voucherType);
  if (params.voucherType && !voucherTypeFilter) {
    throw new AppError(400, 'voucherType must be PAYMENT, RECEIPT, or JOURNAL');
  }

  const productCategoryId =
    params.productCategoryId != null && Number.isFinite(params.productCategoryId) && params.productCategoryId > 0
      ? params.productCategoryId
      : undefined;

  const voucherWhere: Prisma.VoucherWhereInput = {
    status: VoucherStatus.ACTIVE,
    financialYearId,
    type: voucherTypeFilter ? voucherTypeFilter : { in: DAILY_VOUCHER_TYPES },
    date: { gte: from, lte: to },
  };

  const invoiceWhere: Prisma.InvoiceWhereInput = {
    status: InvoiceStatus.POSTED,
    financialYearId,
    type: { in: DAILY_INVOICE_TYPES },
    invoiceDate: { gte: from, lte: to },
    ...(productCategoryId != null
      ? {
          // Category filter: invoices that include at least one matching product line.
          // Kachi Maal has no product.categoryId on lines, so it is excluded when filtering.
          items: {
            some: {
              product: { categoryId: productCategoryId },
            },
          },
        }
      : {}),
  };

  const voucherLimit = params.voucherLimit;
  const voucherOffset = params.voucherOffset ?? 0;
  const invoiceLimit = params.invoiceLimit;
  const invoiceOffset = params.invoiceOffset ?? 0;

  const [voucherTotal, voucherAmountAgg, vouchers, invoiceTotal, invoiceAmountAgg, invoices] =
    await Promise.all([
      prisma.voucher.count({ where: voucherWhere }),
      prisma.voucher.aggregate({ where: voucherWhere, _sum: { amount: true } }),
      prisma.voucher.findMany({
        where: voucherWhere,
        include: {
          debitAccount: { select: { name: true } },
          creditAccount: { select: { name: true } },
          ledgerEntries: {
            where: { isReversal: false },
            include: {
              ledger: { include: { account: { select: { name: true } } } },
            },
          },
        },
        orderBy: [{ number: 'asc' }, { id: 'asc' }],
        ...(voucherLimit != null ? { skip: voucherOffset, take: voucherLimit } : {}),
      }),
      prisma.invoice.count({ where: invoiceWhere }),
      prisma.invoice.aggregate({ where: invoiceWhere, _sum: { total: true } }),
      prisma.invoice.findMany({
        where: invoiceWhere,
        include: {
          debitAccount: { select: { name: true } },
          items: {
            select: {
              quantity: true,
              unitPrice: true,
              taxAmount: true,
              mazduriAmount: true,
              label: true,
              product: { select: { name: true, categoryId: true } },
            },
          },
          kachiMaalLines: {
            orderBy: { sortOrder: 'asc' },
            select: {
              jins: true,
              totalWeightKg: true,
              ratePerMaund: true,
            },
          },
          vouchers: {
            include: {
              voucher: {
                include: {
                  ledgerEntries: {
                    where: { isReversal: false },
                    include: {
                      ledger: {
                        include: {
                          account: {
                            select: {
                              name: true,
                              category: { select: { name: true } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ reference: 'asc' }, { id: 'asc' }],
        ...(invoiceLimit != null ? { skip: invoiceOffset, take: invoiceLimit } : {}),
      }),
    ]);

  const voucherItems: DailyActivityVoucherRow[] = vouchers.map((v) => {
    let debitName = v.debitAccount?.name ?? null;
    let creditName = v.creditAccount?.name ?? null;
    if ((!debitName || !creditName) && v.ledgerEntries.length > 0) {
      const debitNames = v.ledgerEntries
        .filter((e) => e.type === LedgerEntryType.DEBIT)
        .map((e) => e.ledger.account.name);
      const creditNames = v.ledgerEntries
        .filter((e) => e.type === LedgerEntryType.CREDIT)
        .map((e) => e.ledger.account.name);
      if (!debitName) debitName = uniqueJoin(debitNames);
      if (!creditName) creditName = uniqueJoin(creditNames);
    }
    return {
      id: v.id,
      number: v.number,
      type: v.type,
      debitAccountName: debitName,
      creditAccountName: creditName,
      description: v.description,
      amount: Number(v.amount),
      reference: v.reference,
    };
  });

  const invoiceItems: DailyActivityInvoiceRow[] = [];
  for (const inv of invoices) {
    const partyName = inv.debitAccount?.name ?? null;

    const visibleItems =
      productCategoryId != null
        ? inv.items.filter((item) => item.product?.categoryId === productCategoryId)
        : inv.items;

    let productSideLabel: string | null = null;
    let productDescription: string | null = null;

    if (inv.type === InvoiceType.KACHI_MAAL) {
      const kachiLines = inv.kachiMaalLines ?? [];
      productDescription =
        kachiLines.length > 0
          ? formatKachiMaalProductLinesDescription(
              kachiLines.map((line) => ({
                productName: line.jins?.trim() || inv.jins?.trim() || 'Item',
                totalWeightKg: Number(line.totalWeightKg),
                ratePerMaund: Number(line.ratePerMaund),
              })),
            )
          : null;
      productSideLabel =
        uniqueJoin(kachiLines.map((line) => line.jins?.trim() || inv.jins?.trim() || '')) ?? productDescription;
    } else {
      productDescription =
        visibleItems.length > 0
          ? formatInvoiceProductLinesDescription(
              visibleItems.map((item) => ({
                productName: item.product?.name?.trim() || item.label?.trim() || 'Item',
                quantity: Number(item.quantity),
                rate: Number(item.unitPrice),
              })),
            )
          : null;
      productSideLabel =
        uniqueJoin(
          visibleItems.map((item) => item.product?.name?.trim() || item.label?.trim() || ''),
        ) ?? productDescription;
    }

    let debitAccountName: string | null = null;
    let creditAccountName: string | null = null;
    if (inv.type === InvoiceType.PURCHASE_INVOICE) {
      debitAccountName = productSideLabel;
      creditAccountName = partyName;
    } else {
      // SALE_INVOICE / KACHI_MAAL — party debited
      debitAccountName = partyName;
      creditAccountName = productSideLabel;
    }

    const accountingVoucher = inv.vouchers.find((link) =>
      link.voucher.type === VoucherType.SALE_INVOICE
      || link.voucher.type === VoucherType.PURCHASE_INVOICE
      || link.voucher.type === VoucherType.KACHI,
    )?.voucher;

    const paymentDetail = accountingVoucher
      ? await buildPaymentDetailFromLegs(accountingVoucher.ledgerEntries, inv.type)
      : null;

    const mazduriSource = productCategoryId != null ? visibleItems : inv.items;
    const mazduriTotal = roundMoney(
      mazduriSource.reduce((sum, item) => sum + Number(item.mazduriAmount ?? 0), 0),
    );
    const taxTotal = roundMoney(
      mazduriSource.reduce((sum, item) => sum + Number(item.taxAmount ?? 0), 0),
    );

    const descParts = [
      productDescription,
      inv.notes?.trim() || null,
    ].filter(Boolean);

    invoiceItems.push({
      id: inv.id,
      type: inv.type,
      reference: inv.reference,
      debitAccountName,
      creditAccountName,
      description: descParts.length > 0 ? descParts.join(' — ') : null,
      amount: Number(inv.total),
      paymentDetail,
      mazduriDetail: mazduriTotal > 0 ? `Mazduri ${formatMoney(mazduriTotal)}` : null,
      taxDetail: taxTotal > 0 ? `Tax ${formatMoney(taxTotal)}` : null,
    });
  }

  return {
    date: params.date.slice(0, 10),
    financialYearId,
    vouchers: {
      items: voucherItems,
      total: voucherTotal,
      totalAmount: Number(voucherAmountAgg._sum.amount ?? 0),
    },
    invoices: {
      items: invoiceItems,
      total: invoiceTotal,
      totalAmount: Number(invoiceAmountAgg._sum.total ?? 0),
    },
  };
}
