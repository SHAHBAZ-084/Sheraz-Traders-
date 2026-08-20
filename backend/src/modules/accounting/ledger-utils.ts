/** Signed ledger balance: previous + debit − credit (always use this formula). */
export function computeLedgerBalance(
  previousBalance: number,
  debitAmount: number,
  creditAmount: number,
): number {
  return previousBalance + debitAmount - creditAmount;
}

export function entryAmounts(type: 'DEBIT' | 'CREDIT', amount: number) {
  if (type === 'DEBIT') return { debit: amount, credit: 0 };
  return { debit: 0, credit: amount };
}

export function trialBalanceFromSignedBalance(balance: number) {
  return {
    debit: balance > 0 ? balance : 0,
    credit: balance < 0 ? Math.abs(balance) : 0,
  };
}

export function isTrialBalanceBalanced(totalDebit: number, totalCredit: number, tolerance = 0.01) {
  return Math.abs(totalDebit - totalCredit) < tolerance;
}

export function parseVoucherDateInput(value: string | Date): Date {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid voucher date');
  }
  d.setHours(12, 0, 0, 0);
  return d;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function defaultOpeningSide(
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE',
): 'DR' | 'CR' {
  return type === 'ASSET' || type === 'EXPENSE' ? 'DR' : 'CR';
}

export function entryEffectiveDate(entry: {
  date: Date;
}): Date {
  return entry.date;
}

export function compareLedgerEntries(
  a: {
    id: number;
    date: Date;
    isOpeningBalance: boolean;
    voucher?: { number: number } | null;
  },
  b: {
    id: number;
    date: Date;
    isOpeningBalance: boolean;
    voucher?: { number: number } | null;
  },
): number {
  // Opening balance is always the first row in a ledger, regardless of createdAt.
  if (a.isOpeningBalance !== b.isOpeningBalance) {
    return a.isOpeningBalance ? -1 : 1;
  }
  const cmp = entryEffectiveDate(a).getTime() - entryEffectiveDate(b).getTime();
  if (cmp !== 0) return cmp;
  const aNo = a.isOpeningBalance ? 0 : (a.voucher?.number ?? 0);
  const bNo = b.isOpeningBalance ? 0 : (b.voucher?.number ?? 0);
  if (aNo !== bNo) return aNo - bNo;
  return a.id - b.id;
}
