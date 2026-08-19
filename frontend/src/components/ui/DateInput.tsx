import { forwardRef, useEffect, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { displayDateToIso, isoToDisplayDate } from '../../lib/format';

function clampIso(iso: string, min?: string | number, max?: string | number): string {
  if (!iso) return iso;
  const minS = min != null && min !== '' ? String(min) : '';
  const maxS = max != null && max !== '' ? String(max) : '';
  if (minS && iso < minS) return minS;
  if (maxS && iso > maxS) return maxS;
  return iso;
}

/** Digits typed as DDMMYYYY become DD/MM/YYYY. */
function maskDisplayDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * Simple DD/MM/YYYY text field. Controlled value stays YYYY-MM-DD for the API.
 */
export const DateInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function DateInput(props, ref) {
    const {
      value,
      onChange,
      onBlur,
      className = '',
      min,
      max,
      disabled,
      required,
      name,
      id,
      tabIndex,
      ...rest
    } = props;

    const iso = typeof value === 'string' ? value : '';
    const [text, setText] = useState(() => isoToDisplayDate(iso));

    useEffect(() => {
      setText(isoToDisplayDate(iso));
    }, [iso]);

    function emit(nextIso: string) {
      if (!onChange) return;
      const event = {
        target: { value: nextIso, name: name ?? '' },
        currentTarget: { value: nextIso, name: name ?? '' },
      } as ChangeEvent<HTMLInputElement>;
      onChange(event);
    }

    function commit(raw: string): string {
      const parsed = displayDateToIso(raw);
      if (parsed == null) {
        setText(isoToDisplayDate(iso));
        return iso;
      }
      if (!parsed) {
        setText('');
        if (iso) emit('');
        return '';
      }
      const next = clampIso(parsed, min, max);
      setText(isoToDisplayDate(next));
      if (next !== iso) emit(next);
      return next;
    }

    return (
      <input
        {...rest}
        ref={ref}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        lang="en-GB"
        className={`app-input ${className}`.trim()}
        value={text}
        disabled={disabled}
        required={required}
        tabIndex={tabIndex}
        maxLength={10}
        onChange={(e) => {
          const next = maskDisplayDate(e.target.value);
          setText(next);
          const parsed = displayDateToIso(next);
          if (parsed) emit(clampIso(parsed, min, max));
          else if (parsed === '') emit('');
        }}
        onBlur={(e) => {
          commit(text);
          onBlur?.(e);
        }}
      />
    );
  },
);
