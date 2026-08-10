import { forwardRef, useCallback, useRef, type InputHTMLAttributes, type Ref } from 'react';
import { formatAmountInputDisplay, sanitizeAmountInput } from '../../lib/format';
import {
  caretPositionForRawCount,
  countRawNumericCharsBefore,
  isAllowedDecimalKey,
  mergePastedInput,
} from '../../lib/numericInput';
import { TextInput } from './PageShell';

type AmountInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  value: string;
  onChange: (value: string) => void;
};

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(node);
      else ref.current = node;
    }
  };
}

/** Monetary amount field — comma thousands-separators while typing; state stays numeric-only. */
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { value, onChange, onFocus, onKeyDown, onPaste, className = '', ...rest },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);

  const restoreCaret = useCallback((nextValue: string, rawCharsBefore: number) => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      const display = formatAmountInputDisplay(nextValue);
      const caret = caretPositionForRawCount(display, rawCharsBefore);
      el.setSelectionRange(caret, caret);
    });
  }, []);

  const applyValue = useCallback(
    (next: string, rawCharsBefore: number) => {
      onChange(next);
      restoreCaret(next, rawCharsBefore);
    },
    [onChange, restoreCaret],
  );

  const displayValue = formatAmountInputDisplay(value);

  return (
    <TextInput
      ref={mergeRefs(ref, inputRef)}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={(e) => {
        const input = e.currentTarget;
        const caret = input.selectionStart ?? displayValue.length;
        const rawBefore = countRawNumericCharsBefore(displayValue, caret);
        applyValue(sanitizeAmountInput(e.target.value), rawBefore);
      }}
      onKeyDown={(e) => {
        if (!isAllowedDecimalKey(e.key, value, e)) {
          e.preventDefault();
        }
        onKeyDown?.(e);
      }}
      onPaste={(e) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData('text');
        const input = e.currentTarget;
        const start = input.selectionStart ?? displayValue.length;
        const end = input.selectionEnd ?? displayValue.length;
        const rawBefore = countRawNumericCharsBefore(displayValue, start);
        const merged = mergePastedInput(displayValue, pasted, start, end);
        applyValue(sanitizeAmountInput(merged), rawBefore);
        onPaste?.(e);
      }}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
      className={`tabular-nums ${className}`.trim()}
      {...rest}
    />
  );
});
