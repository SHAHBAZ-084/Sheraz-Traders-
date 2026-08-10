const NAVIGATION_KEYS = new Set([
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'Enter',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
]);

function hasModifier(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }) {
  return e.ctrlKey || e.metaKey || e.altKey;
}

/** Digits and at most one decimal point — plain string safe for in-progress typing ("12."). */
export function sanitizeDecimalInput(raw: string): string {
  let cleaned = raw.replace(/,/g, '').replace(/[^\d.]/g, '');
  const dotIndex = cleaned.indexOf('.');
  if (dotIndex !== -1) {
    cleaned = cleaned.slice(0, dotIndex + 1) + cleaned.slice(dotIndex + 1).replace(/\./g, '');
  }
  return cleaned;
}

/** Digits only — for phone fields. */
export function sanitizePhoneInput(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function isAllowedDecimalKey(key: string, value: string, modifiers: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }) {
  if (hasModifier(modifiers)) return true;
  if (NAVIGATION_KEYS.has(key)) return true;
  if (/^\d$/.test(key)) return true;
  if (key === '.' && !value.includes('.')) return true;
  return false;
}

export function isAllowedPhoneKey(key: string, modifiers: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }) {
  if (hasModifier(modifiers)) return true;
  if (NAVIGATION_KEYS.has(key)) return true;
  if (/^\d$/.test(key)) return true;
  return false;
}

export function mergePastedInput(current: string, pasted: string, selectionStart: number, selectionEnd: number) {
  return current.slice(0, selectionStart) + pasted + current.slice(selectionEnd);
}

/** Count digits and decimal points before a display-string caret (ignores comma separators). */
export function countRawNumericCharsBefore(str: string, position: number): number {
  let count = 0;
  for (let i = 0; i < position && i < str.length; i++) {
    const ch = str[i];
    if ((ch >= '0' && ch <= '9') || ch === '.') count++;
  }
  return count;
}

/** Map a raw numeric character count back to a caret index in a comma-formatted display string. */
export function caretPositionForRawCount(display: string, rawCount: number): number {
  if (rawCount <= 0) return 0;
  let count = 0;
  for (let i = 0; i < display.length; i++) {
    const ch = display[i];
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      count++;
      if (count >= rawCount) return i + 1;
    }
  }
  return display.length;
}
