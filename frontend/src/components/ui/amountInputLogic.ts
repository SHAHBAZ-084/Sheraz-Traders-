import { formatAmountInputDisplay, sanitizeAmountInput } from '../../lib/format';
import {
  caretPositionForRawCount,
  countRawNumericCharsBefore,
  sanitizeDecimalInput,
} from '../../lib/numericInput';

export type AmountInputChangeResult = {
  nextValue: string;
  caretRawCount: number;
};

/**
 * Resolve a controlled AmountInput change from the browser's post-edit string.
 * Caret math MUST use the incoming (new) display value — never the previous React
 * display — otherwise digits land at stale indices under fast typing.
 */
export function resolveAmountInputChange(
  incomingDisplayValue: string,
  selectionStart: number | null | undefined,
): AmountInputChangeResult {
  const caret = selectionStart ?? incomingDisplayValue.length;
  const caretRawCount = countRawNumericCharsBefore(incomingDisplayValue, caret);
  const nextValue = sanitizeAmountInput(incomingDisplayValue);
  return { nextValue, caretRawCount };
}

/** Simulate inserting `key` at the end of the current formatted field (common typing path). */
export function applyAmountInputKeystroke(currentRaw: string, key: string): AmountInputChangeResult {
  const display = formatAmountInputDisplay(currentRaw);
  const incoming = `${display}${key}`;
  return resolveAmountInputChange(incoming, incoming.length);
}

/** Simulate Backspace at end of the current formatted field. */
export function applyAmountInputBackspace(currentRaw: string): AmountInputChangeResult {
  const display = formatAmountInputDisplay(currentRaw);
  if (!display) return { nextValue: '', caretRawCount: 0 };
  const incoming = display.slice(0, -1);
  return resolveAmountInputChange(incoming, incoming.length);
}

function digitCount(raw: string): number {
  let n = 0;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') n++;
  }
  return n;
}

/**
 * Dev-only sanity checks for AmountInput commits. Logs when the sanitized result
 * looks inconsistent with a single keystroke / paste.
 */
export function warnAmountInputSanity(
  prevRaw: string,
  nextRaw: string,
  opts: { isPaste: boolean },
): void {
  if (import.meta.env.PROD) return;

  if (!/^\d*\.?\d*$/.test(nextRaw)) {
    console.warn('[AmountInput] sanitized value has unexpected shape', { prevRaw, nextRaw });
  }

  const roundTrip = sanitizeAmountInput(formatAmountInputDisplay(nextRaw));
  if (roundTrip !== nextRaw) {
    console.warn('[AmountInput] display round-trip mismatch', { nextRaw, roundTrip });
  }

  // Incoming digit sequence (commas stripped) should equal sanitized after decimal cleanup.
  const stripped = sanitizeDecimalInput(formatAmountInputDisplay(nextRaw).replace(/,/g, ''));
  if (stripped !== nextRaw) {
    console.warn('[AmountInput] digit sequence mismatch vs display', { nextRaw, stripped });
  }

  if (!opts.isPaste) {
    const delta = Math.abs(digitCount(nextRaw) - digitCount(prevRaw));
    // 0 = typed "." only or no digit change; 1 = single digit add/remove;
    // larger = select-all replace (allowed) — only warn on pathological non-digit junk already covered above.
    if (delta > 1 && digitCount(prevRaw) > 0 && digitCount(nextRaw) > 0) {
      // Select-all + type is common; only note when length shrinks and grows oddly in one step
      // without clearing (e.g. race corruption mid-string). Soft signal for manual QA.
      const grewAndShrunkOddly =
        digitCount(nextRaw) !== digitCount(prevRaw) + 1 &&
        digitCount(nextRaw) !== Math.max(0, digitCount(prevRaw) - 1) &&
        !nextRaw.startsWith(prevRaw) &&
        !prevRaw.startsWith(nextRaw);
      if (grewAndShrunkOddly) {
        console.warn('[AmountInput] unexpected digit-count jump for non-paste edit', {
          prevRaw,
          nextRaw,
          delta,
        });
      }
    }
  }
}

export function caretIndexForAmountValue(rawValue: string, caretRawCount: number): number {
  return caretPositionForRawCount(formatAmountInputDisplay(rawValue), caretRawCount);
}
