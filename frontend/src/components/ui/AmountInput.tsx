import { forwardRef, useLayoutEffect, useRef, type InputHTMLAttributes, type Ref } from 'react';
import { formatAmountInputDisplay } from '../../lib/format';
import {
  countRawNumericCharsBefore,
  isAllowedDecimalKey,
  mergePastedInput,
} from '../../lib/numericInput';
import {
  caretIndexForAmountValue,
  resolveAmountInputChange,
  warnAmountInputSanity,
} from './amountInputLogic';
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

/**
 * Monetary amount field — comma thousands-separators while typing; state stays numeric-only.
 *
 * Caret is restored in useLayoutEffect (before paint / before the next keystroke), never via
 * requestAnimationFrame — which raced against fast typing and scrambled digits.
 */
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { value, onChange, onFocus, onKeyDown, onPaste, className = '', ...rest },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  /** Raw digit/dot count before caret; applied after React commits the formatted value. */
  const pendingCaretRawRef = useRef<number | null>(null);

  const displayValue = formatAmountInputDisplay(value);

  useLayoutEffect(() => {
    const el = inputRef.current;
    const rawCount = pendingCaretRawRef.current;
    if (!el || rawCount == null) return;
    const caret = caretIndexForAmountValue(value, rawCount);
    el.setSelectionRange(caret, caret);
    pendingCaretRawRef.current = null;
  }, [value, displayValue]);

  function commit(incomingDisplay: string, selectionStart: number | null, isPaste: boolean) {
    const { nextValue, caretRawCount } = resolveAmountInputChange(incomingDisplay, selectionStart);
    warnAmountInputSanity(value, nextValue, { isPaste });
    pendingCaretRawRef.current = caretRawCount;
    onChange(nextValue);
  }

  return (
    <TextInput
      ref={mergeRefs(ref, inputRef)}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={(e) => {
        const input = e.currentTarget;
        // Use the browser's post-edit string + caret — not the previous React displayValue.
        commit(e.target.value, input.selectionStart, false);
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
        const merged = mergePastedInput(displayValue, pasted, start, end);
        const { nextValue } = resolveAmountInputChange(merged, null);
        const rawBefore = countRawNumericCharsBefore(displayValue, start);
        const pastedRawLen = resolveAmountInputChange(pasted, pasted.length).nextValue.length;
        warnAmountInputSanity(value, nextValue, { isPaste: true });
        pendingCaretRawRef.current = rawBefore + pastedRawLen;
        onChange(nextValue);
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
