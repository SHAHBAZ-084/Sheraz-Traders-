import { forwardRef, type InputHTMLAttributes } from 'react';
import {
  isAllowedPhoneKey,
  mergePastedInput,
  sanitizePhoneInput,
} from '../../lib/numericInput';
import { TextInput } from './PageShell';

type PhoneInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  value: string;
  onChange: (value: string) => void;
};

/** Phone field — digits only. */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onChange, onKeyDown, onPaste, className = '', ...rest },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="tel"
      value={value}
      onChange={(e) => onChange(sanitizePhoneInput(e.target.value))}
      onKeyDown={(e) => {
        if (!isAllowedPhoneKey(e.key, e)) {
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
        onChange(sanitizePhoneInput(mergePastedInput(value, pasted, start, end)));
        onPaste?.(e);
      }}
      className={className}
      {...rest}
    />
  );
});
