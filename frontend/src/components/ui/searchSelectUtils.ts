import type { SearchSelectOption } from './SearchSelect';

export function filterOptions(options: SearchSelectOption[], query: string): SearchSelectOption[] {
  const safeOpts = options ?? [];
  const q = query.trim().toLowerCase();
  if (!q) return safeOpts;
  return safeOpts.filter((o) => o?.label?.toLowerCase().includes(q));
}

/**
 * Enter: commit highlighted row (defaults to first) or the sole filtered match.
 * Tab: commit only when unambiguous (one match) or user moved highlight with arrows.
 */
export function resolveSelection(
  filtered: SearchSelectOption[],
  highlightIndex: number,
  highlightMovedByKeyboard: boolean,
  mode: 'enter' | 'tab',
): SearchSelectOption | null {
  const safe = filtered ?? [];
  if (safe.length === 0) return null;
  if (safe.length === 1) return safe[0]!;

  if (mode === 'enter') {
    return safe[highlightIndex] ?? safe[0] ?? null;
  }

  if (highlightMovedByKeyboard && safe[highlightIndex]) {
    return safe[highlightIndex]!;
  }

  return null;
}
