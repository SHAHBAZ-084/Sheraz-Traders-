export function formatLedgerAmount(amount: number | string) {
  return Number(amount).toLocaleString('en-PK');
}

/** Running balance: positive = Dr, negative = Cr (never show negative Dr). Zero = no suffix. */
export function formatLedgerBalance(balance: number | string) {
  const n = Number(balance);
  const abs = Math.abs(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n === 0) return '0.00';
  return n > 0 ? `${abs} Dr` : `${abs} Cr`;
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
}

const VOUCHER_TYPE_LABELS: Record<string, string> = {
  PAYMENT: 'Payment',
  RECEIPT: 'Receipt',
  JOURNAL: 'Journal',
  KACHI: 'Kachi',
  PURCHASE_MAAL: 'Purchase Maal',
  SALE_PAUNCH: 'Sale Paunch',
  SALE_COMMISSION: 'Sale Commission',
  BARDANA: 'Bardana',
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

export function voucherTypeColorClass(type: string) {
  const key = type.toUpperCase().replace(/\s+/g, '_');
  if (key === 'PAYMENT') return 'text-voucherPayment';
  if (key === 'RECEIPT') return 'text-voucherReceipt';
  if (key === 'KACHI') return 'text-voucherKachi';
  if (key === 'PURCHASE_MAAL') return 'text-cardPurchaseMaalAccent';
  if (key === 'SALE_PAUNCH') return 'text-cardSalePaunchAccent';
  if (key === 'SALE_COMMISSION') return 'text-cardSaleCommissionAccent';
  if (key === 'BARDANA' || type.trim().toLowerCase() === 'bardana') return 'text-textFinancial';
  if (key.includes('JOURNAL')) return 'text-voucherJournal';
  return 'text-textSecondary';
}
