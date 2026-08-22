import { describe, expect, it } from 'vitest';
import {
  applyDateInputBackspace,
  applyDateInputKeystroke,
  caretIndexForMaskedDate,
  countDigitsBefore,
  maskDisplayDate,
  resolveDateInputChange,
} from './dateInputLogic';

describe('resolveDateInputChange', () => {
  it('counts caret from the incoming display string, not a stale previous display', () => {
    const oldDisplay = '15/0';
    const incoming = '15/08';
    const caret = incoming.length;

    const buggyDigits = countDigitsBefore(oldDisplay, caret);
    const { masked, caretDigitCount } = resolveDateInputChange(incoming, caret);

    expect(masked).toBe('15/08');
    expect(caretDigitCount).toBe(4);
    expect(buggyDigits).toBe(3);
    expect(caretIndexForMaskedDate(masked, caretDigitCount)).toBe(masked.length);
    expect(caretIndexForMaskedDate(masked, buggyDigits)).toBe(4);
  });

  it('inserts slash when crossing day boundary (15 → 15/0)', () => {
    const { masked, caretDigitCount } = resolveDateInputChange('150', 3);
    expect(masked).toBe('15/0');
    expect(caretDigitCount).toBe(3);
    expect(caretIndexForMaskedDate(masked, caretDigitCount)).toBe(4);
  });
});

describe('DateInput rapid keystrokes', () => {
  it('typing 15082026 as fast as possible always yields 15/08/2026', () => {
    let masked = '';
    for (const digit of '15082026') {
      const result = applyDateInputKeystroke(masked, digit);
      masked = result.masked;
      expect(caretIndexForMaskedDate(masked, result.caretDigitCount)).toBe(masked.length);
    }
    expect(masked).toBe('15/08/2026');
  });

  it('repeats 15082026 twenty times without scrambling', () => {
    for (let trial = 0; trial < 20; trial++) {
      let masked = '';
      for (const digit of '15082026') {
        masked = applyDateInputKeystroke(masked, digit).masked;
      }
      expect(masked).toBe('15/08/2026');
    }
  });

  it('rapid type then rapid backspace through auto-inserted slashes stays stable', () => {
    let masked = '';
    for (const digit of '15082026') {
      masked = applyDateInputKeystroke(masked, digit).masked;
    }
    expect(masked).toBe('15/08/2026');

    for (let i = 0; i < 4; i++) {
      const result = applyDateInputBackspace(masked);
      masked = result.masked;
      expect(caretIndexForMaskedDate(masked, result.caretDigitCount)).toBe(masked.length);
    }
    expect(masked).toBe('15/08');
  });

  it('key-repeat style burst of identical digits stays stable', () => {
    let masked = '';
    for (let i = 0; i < 6; i++) {
      const result = applyDateInputKeystroke(masked, '1');
      masked = result.masked;
      expect(caretIndexForMaskedDate(masked, result.caretDigitCount)).toBe(masked.length);
    }
    expect(masked).toBe('11/11/11');
  });
});

describe('maskDisplayDate', () => {
  it('caps at 8 digits', () => {
    expect(maskDisplayDate('150820261999')).toBe('15/08/2026');
  });
});
