import type { Account } from './api';

export type EmbeddedPaymentLineDraft = {
  clientId: string;
  categoryId: string;
  accountId: string;
  amount: string;
};

export function newEmbeddedPaymentLineDraft(): EmbeddedPaymentLineDraft {
  return {
    clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    categoryId: '',
    accountId: '',
    amount: '',
  };
}

export function sumEmbeddedLineAmounts(lines: EmbeddedPaymentLineDraft[]) {
  return lines.reduce((sum, line) => {
    const amount = line.amount.trim() ? Number(line.amount) : 0;
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

export function parseEmbeddedPaymentLinesPayload(
  lines: EmbeddedPaymentLineDraft[],
  invoiceTotal: number,
  label: 'Receipt' | 'Payment',
) {
  const parsed = lines
    .map((line) => ({
      accountId: line.accountId ? Number(line.accountId) : null,
      amount: line.amount.trim() ? Number(line.amount) : 0,
    }))
    .filter((line) => line.amount > 0 || line.accountId != null);

  if (parsed.length === 0) return {};

  const receipts: Array<{ amount: number; accountId: number }> = [];
  for (const line of parsed) {
    if (line.amount <= 0) {
      throw new Error(`Enter an amount for each ${label.toLowerCase()} line with an account selected`);
    }
    if (line.accountId == null) {
      throw new Error(`Select a Bank/Cash account for each ${label.toLowerCase()} amount`);
    }
    receipts.push({ amount: line.amount, accountId: line.accountId });
  }

  const total = receipts.reduce((sum, line) => sum + line.amount, 0);
  if (total > invoiceTotal + 0.01) {
    throw new Error(`Total ${label.toLowerCase()} amount cannot exceed invoice total`);
  }

  return label === 'Receipt' ? { receipts } : { payments: receipts };
}

export function embeddedLinesFromLegacyScalar(
  accounts: Account[],
  accountId: number | null | undefined,
  amount: number | null | undefined,
): EmbeddedPaymentLineDraft[] {
  if (accountId == null || amount == null || Number(amount) <= 0) return [];
  const acct = accounts.find((a) => a.id === accountId);
  return [
    {
      clientId: `legacy-${accountId}`,
      categoryId: acct ? String(acct.categoryId) : '',
      accountId: String(accountId),
      amount: String(amount),
    },
  ];
}

export function embeddedLinesFromStoredJson(
  accounts: Account[],
  raw: unknown,
): EmbeddedPaymentLineDraft[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: EmbeddedPaymentLineDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { amount?: unknown; accountId?: unknown };
    const amount = Number(row.amount);
    const accountId = Number(row.accountId);
    if (!(amount > 0) || !(accountId > 0)) continue;
    const acct = accounts.find((a) => a.id === accountId);
    out.push({
      clientId: `stored-${accountId}-${out.length}`,
      categoryId: acct ? String(acct.categoryId) : '',
      accountId: String(accountId),
      amount: String(amount),
    });
  }
  return out;
}

export function embeddedLinesFromInvoiceVouchers(
  accounts: Account[],
  vouchers: Array<{
    voucher?: {
      id: number;
      type: string;
      status: string;
      amount: number | string;
      debitAccountId?: number | null;
      creditAccountId?: number | null;
    } | null;
  }>,
  kind: 'SALE_RECEIPT' | 'PURCHASE_PAYMENT',
): EmbeddedPaymentLineDraft[] {
  return vouchers
    .filter((link) => link.voucher?.type === kind && link.voucher.status === 'PENDING_APPROVAL')
    .map((link) => {
      const voucher = link.voucher!;
      const accountId =
        kind === 'SALE_RECEIPT' ? voucher.debitAccountId : voucher.creditAccountId;
      const acct = accounts.find((a) => a.id === accountId);
      return {
        clientId: `pending-${voucher.id}`,
        categoryId: acct ? String(acct.categoryId) : '',
        accountId: accountId != null ? String(accountId) : '',
        amount: String(voucher.amount),
      };
    });
}
