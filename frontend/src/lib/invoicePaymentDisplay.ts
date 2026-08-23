import type { Account, AccountCategory, InvoiceDetail, Voucher } from './api';
import type { EmbeddedPaymentLineDraft } from './embeddedInvoicePaymentLines';
import { sumEmbeddedLineAmounts } from './embeddedInvoicePaymentLines';

/** Match backend style; Cash shows as "Cash", Bank as "Bank — Account". */
export function formatBankCashAccountLabel(categoryName: string, accountName: string) {
  const cat = categoryName.trim();
  const acct = accountName.trim();
  if (!cat && !acct) return '—';
  if (!cat) return acct;
  if (!acct) return cat;
  const cl = cat.toLowerCase();
  if (cl.includes('cash') && !cl.includes('bank')) {
    return acct.toLowerCase() === 'cash' || acct.toLowerCase() === cl ? 'Cash' : `${cat} — ${acct}`;
  }
  return `${cat} — ${acct}`;
}

export function paymentLineDisplayLabel(
  line: EmbeddedPaymentLineDraft,
  accounts: Account[],
  categories: AccountCategory[],
): string | null {
  if (!line.accountId) return null;
  const acct = accounts.find((a) => String(a.id) === line.accountId);
  if (!acct) return null;
  const cat =
    categories.find((c) => String(c.id) === line.categoryId) ??
    categories.find((c) => c.id === acct.categoryId) ??
    acct.category;
  return formatBankCashAccountLabel(cat?.name ?? '', acct.name);
}

export type InvoicePaymentDisplayLine = {
  amount: number;
  label: string;
};

export function draftPaymentDisplayLines(
  lines: EmbeddedPaymentLineDraft[],
  accounts: Account[],
  categories: AccountCategory[],
): InvoicePaymentDisplayLine[] {
  return lines
    .map((line) => {
      const amount = line.amount.trim() ? Number(line.amount) : 0;
      if (!(amount > 0)) return null;
      const label = paymentLineDisplayLabel(line, accounts, categories);
      return { amount, label: label ?? 'Bank/Cash' };
    })
    .filter((x): x is InvoicePaymentDisplayLine => x != null);
}

function voucherBankCashAccount(voucher: Voucher, kind: 'SALE_RECEIPT' | 'PURCHASE_PAYMENT') {
  return kind === 'SALE_RECEIPT' ? voucher.debitAccount : voucher.creditAccount;
}

export function embeddedPaymentsFromInvoice(
  invoice: InvoiceDetail,
  kind: 'SALE_RECEIPT' | 'PURCHASE_PAYMENT',
): InvoicePaymentDisplayLine[] {
  const fromVouchers = (invoice.vouchers ?? [])
    .map((link) => link.voucher)
    .filter(
      (v): v is Voucher =>
        !!v &&
        v.type === kind &&
        !v.deletedAt &&
        v.status !== 'CANCELLED' &&
        v.status !== 'REJECTED',
    )
    .map((v) => {
      const amount = Number(v.amount);
      if (!(amount > 0)) return null;
      const acct = voucherBankCashAccount(v, kind);
      const categoryName =
        (acct as { category?: { name?: string } | null } | null | undefined)?.category?.name ?? '';
      return {
        amount,
        label: formatBankCashAccountLabel(categoryName, acct?.name ?? 'Bank/Cash'),
      };
    })
    .filter((x): x is InvoicePaymentDisplayLine => x != null);

  if (fromVouchers.length > 0) return fromVouchers;

  // Legacy single-scalar fields (older invoices)
  if (kind === 'SALE_RECEIPT') {
    const amount = Number(
      (invoice as { embeddedReceiptAmount?: number | string | null }).embeddedReceiptAmount ?? 0,
    );
    const acct = (invoice as {
      embeddedReceiptAccount?: { name?: string; category?: { name?: string } | null } | null;
    }).embeddedReceiptAccount;
    if (amount > 0 && acct?.name) {
      return [
        {
          amount,
          label: formatBankCashAccountLabel(acct.category?.name ?? '', acct.name),
        },
      ];
    }
  } else {
    const amount = Number(
      (invoice as { embeddedPaymentAmount?: number | string | null }).embeddedPaymentAmount ?? 0,
    );
    const acct = (invoice as {
      embeddedPaymentAccount?: { name?: string; category?: { name?: string } | null } | null;
    }).embeddedPaymentAccount;
    if (amount > 0 && acct?.name) {
      return [
        {
          amount,
          label: formatBankCashAccountLabel(acct.category?.name ?? '', acct.name),
        },
      ];
    }
  }

  return [];
}

export function sumPaymentDisplayAmounts(lines: InvoicePaymentDisplayLine[]) {
  return lines.reduce((sum, line) => sum + line.amount, 0);
}

export function formatPaymentLinesDetail(
  lines: InvoicePaymentDisplayLine[],
  formatAmount: (n: number) => string,
): string {
  if (lines.length === 0) return '0';
  return lines.map((line) => `${formatAmount(line.amount)} (${line.label})`).join(' + ');
}

export function invoiceRemaining(total: number, paidOrReceived: number) {
  const remaining = total - paidOrReceived;
  return remaining > 0 ? remaining : 0;
}

export { sumEmbeddedLineAmounts };
