import { describe, expect, it } from 'vitest';
import { AppError } from '../../utils/helpers';
import {
  parseEmbeddedPaymentInput,
  parseEmbeddedPaymentLinesInput,
  parseEmbeddedReceiptInput,
  parseEmbeddedReceiptLinesInput,
} from './invoice-embedded-voucher';

describe('parseEmbeddedReceiptLinesInput', () => {
  it('returns empty array when no lines are provided', () => {
    expect(parseEmbeddedReceiptLinesInput({}, 50_000)).toEqual([]);
  });

  it('accepts a single line via receipts array', () => {
    expect(parseEmbeddedReceiptLinesInput({ receipts: [{ amount: 20_000, accountId: 3 }] }, 50_000)).toEqual([
      { amount: 20_000, accountId: 3 },
    ]);
  });

  it('accepts multiple receipt lines when sum is within invoice total', () => {
    expect(
      parseEmbeddedReceiptLinesInput(
        {
          receipts: [
            { amount: 20_000, accountId: 3 },
            { amount: 25_000, accountId: 4 },
          ],
        },
        50_000,
      ),
    ).toEqual([
      { amount: 20_000, accountId: 3 },
      { amount: 25_000, accountId: 4 },
    ]);
  });

  it('throws when total receipt amount exceeds invoice total', () => {
    expect(() =>
      parseEmbeddedReceiptLinesInput(
        {
          receipts: [
            { amount: 30_000, accountId: 3 },
            { amount: 25_000, accountId: 4 },
          ],
        },
        50_000,
      ),
    ).toThrow(/Total receipt amount cannot exceed invoice total/);
  });

  it('still supports legacy single-line scalar fields', () => {
    expect(parseEmbeddedReceiptLinesInput({ receiptAmount: 20_000, receiptAccountId: 3 }, 50_000)).toEqual([
      { amount: 20_000, accountId: 3 },
    ]);
  });
});

describe('parseEmbeddedReceiptInput', () => {
  it('returns null when amount and account are omitted', () => {
    expect(parseEmbeddedReceiptInput(undefined, undefined, 50_000)).toBeNull();
  });

  it('returns null when amount is explicitly zero', () => {
    expect(parseEmbeddedReceiptInput(0, undefined, 50_000)).toBeNull();
  });

  it('throws when amount exceeds invoice total', () => {
    expect(() => parseEmbeddedReceiptInput(60_000, 1, 50_000)).toThrow(AppError);
    expect(() => parseEmbeddedReceiptInput(60_000, 1, 50_000)).toThrow(/cannot exceed invoice total/);
  });

  it('throws when account is missing but amount is positive', () => {
    expect(() => parseEmbeddedReceiptInput(20_000, undefined, 50_000)).toThrow(/Receipt account is required/);
  });

  it('throws when amount is missing but account is set', () => {
    expect(() => parseEmbeddedReceiptInput(0, 5, 50_000)).toThrow(/Receipt amount is required/);
  });

  it('accepts partial and full payment amounts', () => {
    expect(parseEmbeddedReceiptInput(20_000, 3, 50_000)).toEqual({ amount: 20_000, accountId: 3 });
    expect(parseEmbeddedReceiptInput(50_000, 3, 50_000)).toEqual({ amount: 50_000, accountId: 3 });
  });
});

describe('parseEmbeddedPaymentLinesInput', () => {
  it('accepts multiple payment lines when sum is within invoice total', () => {
    expect(
      parseEmbeddedPaymentLinesInput(
        {
          payments: [
            { amount: 10_000, accountId: 2 },
            { amount: 15_000, accountId: 3 },
          ],
        },
        50_000,
      ),
    ).toEqual([
      { amount: 10_000, accountId: 2 },
      { amount: 15_000, accountId: 3 },
    ]);
  });

  it('throws when total payment amount exceeds invoice total', () => {
    expect(() =>
      parseEmbeddedPaymentLinesInput(
        {
          payments: [
            { amount: 30_000, accountId: 2 },
            { amount: 25_000, accountId: 3 },
          ],
        },
        50_000,
      ),
    ).toThrow(/Total payment amount cannot exceed invoice total/);
  });
});

describe('parseEmbeddedPaymentInput', () => {
  it('returns null when amount and account are omitted', () => {
    expect(parseEmbeddedPaymentInput(undefined, undefined, 50_000)).toBeNull();
  });

  it('returns null when amount is explicitly zero', () => {
    expect(parseEmbeddedPaymentInput(0, undefined, 50_000)).toBeNull();
  });

  it('throws when amount exceeds invoice total', () => {
    expect(() => parseEmbeddedPaymentInput(60_000, 1, 50_000)).toThrow(/cannot exceed invoice total/);
  });

  it('accepts partial and full payment amounts', () => {
    expect(parseEmbeddedPaymentInput(20_000, 3, 50_000)).toEqual({ amount: 20_000, accountId: 3 });
    expect(parseEmbeddedPaymentInput(50_000, 3, 50_000)).toEqual({ amount: 50_000, accountId: 3 });
  });
});
