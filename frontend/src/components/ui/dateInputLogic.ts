/** DD/MM/YYYY display mask — digits only, max 8. */
export function maskDisplayDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function countDigitsBefore(str: string, position: number): number {
  let count = 0;
  for (let i = 0; i < position && i < str.length; i++) {
    const ch = str[i];
    if (ch >= '0' && ch <= '9') count++;
  }
  return count;
}

/** Map a raw digit count to a caret index in a masked DD/MM/YYYY string. */
export function caretIndexForMaskedDate(masked: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let count = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch >= '0' && ch <= '9') {
      count++;
      if (count >= digitCount) return i + 1;
    }
  }
  return masked.length;
}

export type DateInputChangeResult = {
  masked: string;
  caretDigitCount: number;
};

/**
 * Resolve a controlled DateInput change from the browser's post-edit string.
 * Caret math MUST use the incoming (new) display value — never the previous React
 * display — otherwise digits land at stale indices under fast typing.
 */
export function resolveDateInputChange(
  incomingDisplayValue: string,
  selectionStart: number | null | undefined,
): DateInputChangeResult {
  const caret = selectionStart ?? incomingDisplayValue.length;
  const caretDigitCount = countDigitsBefore(incomingDisplayValue, caret);
  const masked = maskDisplayDate(incomingDisplayValue);
  return { masked, caretDigitCount };
}

/** Simulate inserting `key` at the end of the current masked field (common typing path). */
export function applyDateInputKeystroke(currentMasked: string, key: string): DateInputChangeResult {
  const incoming = `${currentMasked}${key}`;
  return resolveDateInputChange(incoming, incoming.length);
}

/** Simulate Backspace at end of the current masked field. */
export function applyDateInputBackspace(currentMasked: string): DateInputChangeResult {
  if (!currentMasked) return resolveDateInputChange('', 0);
  const incoming = currentMasked.slice(0, -1);
  return resolveDateInputChange(incoming, incoming.length);
}
