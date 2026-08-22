import { describe, expect, it } from 'vitest';
import { AppError } from '../../utils/helpers';
import {
  parseEmbeddedPaymentInput,
  parseEmbeddedReceiptInput,
} from './invoice-embedded-voucher';

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
