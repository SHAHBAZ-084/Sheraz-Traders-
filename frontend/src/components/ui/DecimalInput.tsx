import { forwardRef, type InputHTMLAttributes } from 'react';
import {
  isAllowedDecimalKey,
  mergePastedInput,
  sanitizeDecimalInput,
} from '../../lib/numericInput';
import { TextInput } from './PageShell';

type DecimalInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
};

/** Numeric decimal field — digits and one decimal point only; value stays a plain string. */
export const DecimalInput = forwardRef<HTMLInputElement, DecimalInputProps>(function DecimalInput(
  { value, onChange, onKeyDown, onPaste, className = '', inputMode = 'decimal', ...rest },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      type="text"
      inputMode={inputMode}
      value={value}
      onChange={(e) => onChange(sanitizeDecimalInput(e.target.value))}
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
        const start = input.selectionStart ?? value.length;
        const end = input.selectionEnd ?? value.length;
        onChange(sanitizeDecimalInput(mergePastedInput(value, pasted, start, end)));
        onPaste?.(e);
      }}
      className={className}
      {...rest}
    />
  );
});
