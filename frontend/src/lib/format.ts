export function formatAmount(
  amount: number | string | null | undefined,
  fractionDigits?: number,
) {
  if (amount == null || amount === '') {
    return fractionDigits != null
      ? Number(0).toLocaleString('en-PK', {
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        })
      : '0';
  }
  const opts =
    fractionDigits != null
      ? { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }
      : undefined;
  return Number(amount).toLocaleString('en-PK', opts);
}
export const formatLedgerAmount = formatAmount;

import { sanitizeDecimalInput } from './numericInput';

/** Strip commas and invalid chars — returns clean numeric string for state/API (may end with "."). */
export const sanitizeAmountInput = sanitizeDecimalInput;

/** Comma-formatted display string for amount inputs (preserves trailing decimal while typing). */
export function formatAmountInputDisplay(value: string): string {
  const sanitized = sanitizeAmountInput(value);
  if (!sanitized) return '';

  const dotPos = sanitized.indexOf('.');
  const intRaw = dotPos === -1 ? sanitized : sanitized.slice(0, dotPos);
  const decRaw = dotPos === -1 ? '' : sanitized.slice(dotPos + 1);
  const trailingDot = sanitized.endsWith('.');

  let intFormatted = '';
  if (intRaw) {
    intFormatted = Number(intRaw).toLocaleString('en-PK');
  } else if (dotPos !== -1) {
    intFormatted = '0';
  }

  if (dotPos === -1) return intFormatted;
  if (trailingDot && !decRaw) return `${intFormatted}.`;
  return decRaw ? `${intFormatted}.${decRaw}` : intFormatted;
}

/** Running balance: positive = Dr, negative = Cr (never show negative Dr). Zero = no suffix. */
export function formatLedgerBalance(balance: number | string) {
  const n = Number(balance);
  const abs = Math.abs(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n === 0) return '0.00';
  return n > 0 ? `${abs} Dr` : `${abs} Cr`;
}

/** Day-first display locale (19 Aug 2026 / 19/08/2026). Stored values stay YYYY-MM-DD. */
export const DATE_DISPLAY_LOCALE = 'en-GB';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function parseDateValue(date: string | Date): Date {
  if (date instanceof Date) return date;
  const iso = date.match(ISO_DATE_RE);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  return new Date(date);
}

export function formatDate(date: string | Date) {
  return parseDateValue(date).toLocaleDateString(DATE_DISPLAY_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date) {
  const d = parseDateValue(date);
  return `${formatDate(d)} ${d.toLocaleTimeString(DATE_DISPLAY_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** Visual date for inputs: DD/MM/YYYY. Empty string stays empty. */
export function isoToDisplayDate(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) return '';
  const match = trimmed.match(ISO_DATE_RE);
  if (!match) return trimmed;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Parse a typed date into YYYY-MM-DD, or null if incomplete/invalid. */
export function displayDateToIso(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (ISO_DATE_RE.test(trimmed) && trimmed.length === 10) return trimmed.slice(0, 10);

  const match = trimmed.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const VOUCHER_TYPE_LABELS: Record<string, string> = {
  PAYMENT: 'Payment',
  RECEIPT: 'Receipt',
  JOURNAL: 'Journal',
  KACHI: 'Kachi',
  SALE_INVOICE: 'Sale Invoice',
  PURCHASE_INVOICE: 'Purchase Invoice',
};

export function formatVoucherTypeLabel(type: string) {
  const key = type.toUpperCase().replace(/\s+/g, '_');
  if (type.toUpperCase().startsWith('JOURNAL')) return type.includes('(') ? type : VOUCHER_TYPE_LABELS.JOURNAL;
  if (type.trim().toLowerCase() === 'bardana') return 'Bardana';
  return VOUCHER_TYPE_LABELS[key] ?? type;
}

export function formatVoucherNumber(number: number | string | null | undefined, _type?: string) {
  if (number == null || number === '') return '';
  return String(number);
}

/** Voucher register number only — type is shown in its own column/label. */
export function formatVoucherLabel(type: string, number: number | string) {
  return formatVoucherNumber(number, type);
}

/** Ledger view: debit column always red, credit column always green (independent of voucher type). */
export function ledgerDebitAmountClass(hasAmount: boolean) {
  return hasAmount ? 'text-ledgerDebit font-semibold' : '';
}

export function ledgerCreditAmountClass(hasAmount: boolean) {
  return hasAmount ? 'text-ledgerCredit font-semibold' : '';
}

export function voucherTypeColorClass(type: string) {
  const key = type.toUpperCase().replace(/\s+/g, '_');
  if (key === 'PAYMENT') return 'text-voucherPayment';
  if (key === 'RECEIPT') return 'text-voucherReceipt';
  if (key === 'KACHI') return 'text-voucherKachi';
  if (key === 'SALE_INVOICE') return 'text-cardSalePaunchAccent';
  if (key === 'PURCHASE_INVOICE') return 'text-cardPurchaseMaalAccent';
  if (key === 'BARDANA' || type.trim().toLowerCase() === 'bardana') return 'text-textFinancial';
  if (key.includes('JOURNAL')) return 'text-voucherJournal';
  return 'text-textSecondary';
}
