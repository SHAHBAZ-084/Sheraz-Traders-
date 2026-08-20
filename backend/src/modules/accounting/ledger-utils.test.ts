import { describe, expect, it } from 'vitest';
import {
  computeLedgerBalance,
  compareLedgerEntries,
  defaultOpeningSide,
  isTrialBalanceBalanced,
  parseVoucherDateInput,
  trialBalanceFromSignedBalance,
} from './ledger-utils';

describe('computeLedgerBalance', () => {
  it('applies previousBalance + debit - credit', () => {
    expect(computeLedgerBalance(10000, 5000, 0)).toBe(15000);
    expect(computeLedgerBalance(10000, 0, 5000)).toBe(5000);
    expect(computeLedgerBalance(0, 20000, 50000)).toBe(-30000);
  });
});

describe('trialBalanceFromSignedBalance', () => {
  it('maps positive to debit and negative to credit', () => {
    expect(trialBalanceFromSignedBalance(10000)).toEqual({ debit: 10000, credit: 0 });
    expect(trialBalanceFromSignedBalance(-50000)).toEqual({ debit: 0, credit: 50000 });
    expect(trialBalanceFromSignedBalance(0)).toEqual({ debit: 0, credit: 0 });
  });
});

describe('isTrialBalanceBalanced', () => {
  it('returns true when totals match', () => {
    expect(isTrialBalanceBalanced(80000, 80000)).toBe(true);
  });

  it('returns false when totals diverge', () => {
    expect(isTrialBalanceBalanced(80000, 79999)).toBe(false);
  });
});

describe('compareLedgerEntries', () => {
  it('sorts by voucher date then voucher number', () => {
    const early = {
      id: 2,
      date: new Date('2026-07-01'),
      isOpeningBalance: false,
      voucher: { number: 2 },
    };
    const late = {
      id: 1,
      date: new Date('2026-07-15'),
      isOpeningBalance: false,
      voucher: { number: 1 },
    };
    expect(compareLedgerEntries(early, late)).toBeLessThan(0);
  });

  it('always places opening balance before same-day vouchers', () => {
    const opening = {
      id: 99,
      date: new Date('2026-07-30T18:00:00'),
      isOpeningBalance: true,
      voucher: null,
    };
    const payment = {
      id: 1,
      date: new Date('2026-07-30T10:00:00'),
      isOpeningBalance: false,
      voucher: { number: 1 },
    };
    expect(compareLedgerEntries(opening, payment)).toBeLessThan(0);
    expect(compareLedgerEntries(payment, opening)).toBeGreaterThan(0);
  });
});

describe('defaultOpeningSide', () => {
  it('defaults assets and expenses to Dr', () => {
    expect(defaultOpeningSide('ASSET')).toBe('DR');
    expect(defaultOpeningSide('EXPENSE')).toBe('DR');
    expect(defaultOpeningSide('LIABILITY')).toBe('CR');
  });
});

describe('parseVoucherDateInput', () => {
  it('parses ISO date strings', () => {
    const d = parseVoucherDateInput('2026-01-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
  });

  it('throws on invalid dates', () => {
    expect(() => parseVoucherDateInput('not-a-date')).toThrow('Invalid voucher date');
  });
});

describe('display convention (frontend mirrors this)', () => {
  function formatSignedBalance(balance: number) {
    if (balance === 0) return '0.00';
    const abs = Math.abs(balance).toFixed(2);
    return balance > 0 ? `${abs} Dr` : `${abs} Cr`;
  }

  it('never shows negative Dr', () => {
    expect(formatSignedBalance(-30000)).toBe('30000.00 Cr');
  });

  it('shows zero without suffix', () => {
    expect(formatSignedBalance(0)).toBe('0.00');
  });
});
