import { describe, expect, it, vi } from 'vitest';
import { formatAmountInputDisplay } from '../../lib/format';
import { countRawNumericCharsBefore, caretPositionForRawCount } from '../../lib/numericInput';
import {
  applyAmountInputBackspace,
  applyAmountInputKeystroke,
  resolveAmountInputChange,
} from './amountInputLogic';

describe('resolveAmountInputChange', () => {
  it('counts caret from the incoming display string, not a stale previous display', () => {
    const oldDisplay = '1,200';
    const incoming = '1,2000'; // typed 0 at end
    const caret = incoming.length;

    const buggyRaw = countRawNumericCharsBefore(oldDisplay, caret);
    const { nextValue, caretRawCount } = resolveAmountInputChange(incoming, caret);

    expect(nextValue).toBe('12000');
    expect(caretRawCount).toBe(5);
    expect(buggyRaw).toBe(4);
    expect(caretPositionForRawCount(formatAmountInputDisplay(nextValue), caretRawCount)).toBe(
      formatAmountInputDisplay(nextValue).length,
    );
    // Old buggy caret would land one digit early inside "12,000"
    expect(caretPositionForRawCount(formatAmountInputDisplay(nextValue), buggyRaw)).toBe(5);
  });

  it('handles comma insertion boundary when crossing 999 → 1,000', () => {
    let value = '999';
    for (const digit of '0') {
      const result = applyAmountInputKeystroke(value, digit);
      value = result.nextValue;
      expect(caretPositionForRawCount(formatAmountInputDisplay(value), result.caretRawCount)).toBe(
        formatAmountInputDisplay(value).length,
      );
    }
    expect(value).toBe('9990');
    expect(formatAmountInputDisplay(value)).toBe('9,990');
  });
});

describe('AmountInput rapid keystrokes (no animation-frame gaps)', () => {
  it('typing 12000 as fast as possible always yields 12000 / 12,000', () => {
    let value = '';
    for (const digit of '12000') {
      const result = applyAmountInputKeystroke(value, digit);
      value = result.nextValue;
    }
    expect(value).toBe('12000');
    expect(formatAmountInputDisplay(value)).toBe('12,000');
  });

  it('repeats 12000 twenty times without scrambling', () => {
    for (let trial = 0; trial < 20; trial++) {
      let value = '';
      for (const digit of '12000') {
        value = applyAmountInputKeystroke(value, digit).nextValue;
      }
      expect(value).toBe('12000');
      expect(formatAmountInputDisplay(value)).toBe('12,000');
    }
  });

  it('handles various lengths and decimals under rapid sequential commits', () => {
    const cases = ['999999', '1500.75', '45000', '1.5', '1000000'];
    for (const typed of cases) {
      let value = '';
      for (const ch of typed) {
        value = applyAmountInputKeystroke(value, ch).nextValue;
      }
      expect(value).toBe(typed);
      expect(formatAmountInputDisplay(value).replace(/,/g, '')).toBe(typed);
    }
  });

  it('rapid type then rapid backspace does not corrupt', () => {
    let value = '';
    for (const digit of '45000') {
      value = applyAmountInputKeystroke(value, digit).nextValue;
    }
    expect(value).toBe('45000');

    for (let i = 0; i < 3; i++) {
      value = applyAmountInputBackspace(value).nextValue;
    }
    expect(value).toBe('45');
    expect(formatAmountInputDisplay(value)).toBe('45');

    for (const digit of '999') {
      value = applyAmountInputKeystroke(value, digit).nextValue;
    }
    expect(value).toBe('45999');
    expect(formatAmountInputDisplay(value)).toBe('45,999');
  });

  it('key-repeat style burst of identical digits stays stable', () => {
    let value = '';
    for (let i = 0; i < 8; i++) {
      value = applyAmountInputKeystroke(value, '9').nextValue;
    }
    expect(value).toBe('99999999');
    expect(formatAmountInputDisplay(value)).toBe('99,999,999');
  });
});

describe('warnAmountInputSanity', async () => {
  it('does not throw on normal edits', async () => {
    const { warnAmountInputSanity } = await import('./amountInputLogic');
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnAmountInputSanity('12', '120', { isPaste: false });
    warnAmountInputSanity('', '12000', { isPaste: true });
    spy.mockRestore();
  });
});
