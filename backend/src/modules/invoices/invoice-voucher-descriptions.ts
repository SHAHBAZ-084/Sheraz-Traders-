import { InvoiceType, VoucherStatus, VoucherType } from '@prisma/client';
import { formatBankCashAccountLabel } from './invoice-embedded-voucher';
import { formatWeightMaundKg } from './kachi-maal.calculations';
import { roundMoney } from './sale-invoice.calculations';

export type InvoiceVoucherHeader = {
  tafseel?: string | null;
  gariNo?: string | null;
};

export type InvoiceVoucherLine = {
  totalWeightKg: number;
  ratePerMaund: number;
  jins?: string | null;
};

export type InvoiceProductLineDescription = {
  productName: string;
  quantity: number;
  rate: number;
};

function formatInvoiceLineNumber(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return String(rounded);
}

/** Sale/Purchase Invoice ledger description — e.g. `Urea 5@4550+Dap 6@12500`. */
export function formatInvoiceProductLinesDescription(lines: InvoiceProductLineDescription[]): string {
  return lines
    .map((line) => {
      const name = line.productName.trim() || 'Item';
      return `${name} ${formatInvoiceLineNumber(line.quantity)}@${formatInvoiceLineNumber(line.rate)}`;
    })
    .join('+');
}

export function voucherReferenceFromBillNo(billNo?: string | null): string {
  return billNo?.trim() ?? '';
}

function formatRate(rate: number) {
  return Number(rate).toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function invoiceVoucherHeaderSuffix(header: InvoiceVoucherHeader): string {
  const parts: string[] = [];
  if (header.tafseel?.trim()) parts.push(`Tafseel: ${header.tafseel.trim()}`);
  if (header.gariNo?.trim()) parts.push(`Gari#: ${header.gariNo.trim()}`);
  if (parts.length === 0) return '';
  return ` — ${parts.join(', ')}`;
}

function resolveLineJins(line: InvoiceVoucherLine, invoiceJins?: string | null): string | null {
  const fromLine = line.jins?.trim();
  if (fromLine) return fromLine;
  const fromInvoice = invoiceJins?.trim();
  return fromInvoice || null;
}

function formatLineWeightWithJins(line: InvoiceVoucherLine, invoiceJins?: string | null): string {
  const weight = formatWeightMaundKg(line.totalWeightKg);
  const jins = resolveLineJins(line, invoiceJins);
  return jins ? `${jins} ${weight}` : weight;
}

export function rowLegDescription(
  line: InvoiceVoucherLine,
  header: InvoiceVoucherHeader,
  invoiceJins?: string | null,
): string {
  const core = `${formatLineWeightWithJins(line, invoiceJins)} @ Rs ${formatRate(line.ratePerMaund)}/maund`;
  return core + invoiceVoucherHeaderSuffix(header);
}

export function blendedLegDescription(
  lines: InvoiceVoucherLine[],
  header: InvoiceVoucherHeader,
  invoiceJins?: string | null,
): string {
  const totalWeightKg = lines.reduce((sum, line) => sum + Number(line.totalWeightKg), 0);
  if (totalWeightKg <= 0) {
    const suffix = invoiceVoucherHeaderSuffix(header);
    return suffix ? suffix.replace(/^ — /, '') : '—';
  }

  const resolvedJins = lines.map((line) => resolveLineJins(line, invoiceJins));
  const uniqueJins = [...new Set(resolvedJins.filter((j): j is string => Boolean(j)))];

  let weightPart: string;
  if (uniqueJins.length <= 1) {
    const weight = formatWeightMaundKg(totalWeightKg);
    weightPart = uniqueJins[0] ? `${uniqueJins[0]} ${weight}` : weight;
  } else {
    weightPart = lines.map((line) => formatLineWeightWithJins(line, invoiceJins)).join(' + ');
  }

  let weightedRateSum = 0;
  for (const line of lines) {
    weightedRateSum += Number(line.totalWeightKg) * Number(line.ratePerMaund);
  }
  const blendedRate = weightedRateSum / totalWeightKg;
  const core = `${weightPart} @ Rs ${formatRate(blendedRate)}/maund`;
  return core + invoiceVoucherHeaderSuffix(header);
}

export function isBardanaLedgerNote(notes?: string | null): boolean {
  const n = notes?.trim().toLowerCase() ?? '';
  if (!n) return false;
  return n === 'bardana' || n.startsWith('bardana against') || n.startsWith('bardana ');
}

type PendingInvoiceLineItem = {
  label?: string | null;
  quantity: number | string | { toString(): string };
  unitPrice: number | string | { toString(): string };
  product?: { name: string } | null;
};

type PendingInvoiceKachiLine = {
  jins?: string | null;
  totalWeightKg: number | string | { toString(): string };
  ratePerMaund: number | string | { toString(): string };
};

type PendingInvoiceEmbeddedVoucher = {
  type: string;
  status: string;
  amount: number | string | { toString(): string };
  debitAccount?: { name: string; category?: { name: string } | null } | null;
  creditAccount?: { name: string; category?: { name: string } | null } | null;
};

export type PendingInvoiceDescriptionInput = {
  type: InvoiceType | string;
  notes?: string | null;
  billNo?: string | null;
  jins?: string | null;
  tafseel?: string | null;
  gariNo?: string | null;
  items?: PendingInvoiceLineItem[];
  kachiMaalLines?: PendingInvoiceKachiLine[];
  embeddedReceiptAmount?: number | string | null;
  embeddedPaymentAmount?: number | string | null;
  embeddedReceiptAccount?: { name: string; category?: { name: string } | null } | null;
  embeddedPaymentAccount?: { name: string; category?: { name: string } | null } | null;
  vouchers?: Array<{ voucher: PendingInvoiceEmbeddedVoucher }>;
};

function formatPendingPaymentAmount(amount: number) {
  const n = roundMoney(amount);
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return String(n);
}

function embeddedReceiptPaymentNote(inv: PendingInvoiceDescriptionInput): string | null {
  const appendParts: string[] = [];

  if (inv.type === InvoiceType.SALE_INVOICE) {
    const pendingReceipts =
      inv.vouchers?.filter(
        (link) =>
          link.voucher.type === VoucherType.SALE_RECEIPT
          && link.voucher.status === VoucherStatus.PENDING_APPROVAL,
      ) ?? [];

    if (pendingReceipts.length > 0) {
      const total = roundMoney(
        pendingReceipts.reduce((sum, link) => sum + Number(link.voucher.amount), 0),
      );
      const labels = pendingReceipts.map((link) => {
        const acct = link.voucher.debitAccount;
        return acct
          ? formatBankCashAccountLabel(acct.category?.name ?? '', acct.name)
          : 'Cash/Bank';
      });
      appendParts.push(`Received ${formatPendingPaymentAmount(total)} (${labels.join(' + ')})`);
    } else if (
      inv.embeddedReceiptAmount != null
      && Number(inv.embeddedReceiptAmount) > 0
      && inv.embeddedReceiptAccount
    ) {
      appendParts.push(
        `Received ${formatPendingPaymentAmount(Number(inv.embeddedReceiptAmount))} (${formatBankCashAccountLabel(
          inv.embeddedReceiptAccount.category?.name ?? '',
          inv.embeddedReceiptAccount.name,
        )})`,
      );
    }
  } else if (inv.type === InvoiceType.PURCHASE_INVOICE) {
    const pendingPayments =
      inv.vouchers?.filter(
        (link) =>
          link.voucher.type === VoucherType.PURCHASE_PAYMENT
          && link.voucher.status === VoucherStatus.PENDING_APPROVAL,
      ) ?? [];

    if (pendingPayments.length > 0) {
      const total = roundMoney(
        pendingPayments.reduce((sum, link) => sum + Number(link.voucher.amount), 0),
      );
      const labels = pendingPayments.map((link) => {
        const acct = link.voucher.creditAccount;
        return acct
          ? formatBankCashAccountLabel(acct.category?.name ?? '', acct.name)
          : 'Cash/Bank';
      });
      appendParts.push(`Paid ${formatPendingPaymentAmount(total)} (${labels.join(' + ')})`);
    } else if (
      inv.embeddedPaymentAmount != null
      && Number(inv.embeddedPaymentAmount) > 0
      && inv.embeddedPaymentAccount
    ) {
      appendParts.push(
        `Paid ${formatPendingPaymentAmount(Number(inv.embeddedPaymentAmount))} (${formatBankCashAccountLabel(
          inv.embeddedPaymentAccount.category?.name ?? '',
          inv.embeddedPaymentAccount.name,
        )})`,
      );
    }
  }

  return appendParts.length > 0 ? appendParts.join('; ') : null;
}

/** Rich pending-approval list description for invoices (product lines, kachi blend, notes, payment). */
export function buildPendingInvoiceApprovalDescription(inv: PendingInvoiceDescriptionInput): string | null {
  let core: string | null = null;

  if (inv.type === InvoiceType.KACHI_MAAL) {
    const lines = inv.kachiMaalLines ?? [];
    if (lines.length > 0) {
      core = blendedLegDescription(
        lines.map((line) => ({
          totalWeightKg: Number(line.totalWeightKg),
          ratePerMaund: Number(line.ratePerMaund),
          jins: line.jins,
        })),
        { tafseel: inv.tafseel, gariNo: inv.gariNo },
        inv.jins,
      );
      if (core === '—') core = null;
    }
  } else {
    const items = inv.items ?? [];
    if (items.length > 0) {
      core = formatInvoiceProductLinesDescription(
        items.map((item) => ({
          productName: item.product?.name?.trim() || item.label?.trim() || 'Unknown product',
          quantity: Number(item.quantity),
          rate: Number(item.unitPrice),
        })),
      );
    }
  }

  const notes = inv.notes?.trim() || null;
  const billNo = inv.billNo?.trim() || null;
  const paymentNote = embeddedReceiptPaymentNote(inv);

  const parts = [core, notes, paymentNote].filter((part): part is string => Boolean(part?.trim()));

  if (parts.length > 0) return parts.join(' — ');

  return billNo;
}
