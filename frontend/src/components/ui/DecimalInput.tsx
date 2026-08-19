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
} from './amountInputLogic';
import { TextInput } from './PageShell';

type DecimalInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
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
 * Numeric decimal field — thousand separators while typing; onChange still emits a plain
 * numeric string (no commas) so parents/calculations stay unchanged.
 */
export const DecimalInput = forwardRef<HTMLInputElement, DecimalInputProps>(function DecimalInput(
  { value, onChange, onKeyDown, onPaste, className = '', inputMode = 'decimal', ...rest },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
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

  function commit(incomingDisplay: string, selectionStart: number | null) {
    const { nextValue, caretRawCount } = resolveAmountInputChange(incomingDisplay, selectionStart);
    pendingCaretRawRef.current = caretRawCount;
    onChange(nextValue);
  }

  return (
    <TextInput
      ref={mergeRefs(ref, inputRef)}
      type="text"
      inputMode={inputMode}
      value={displayValue}
      onChange={(e) => {
        const input = e.currentTarget;
        commit(e.target.value, input.selectionStart);
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
        pendingCaretRawRef.current = rawBefore + pastedRawLen;
        onChange(nextValue);
        onPaste?.(e);
      }}
      className={`tabular-nums ${className}`.trim()}
      {...rest}
    />
  );
});
