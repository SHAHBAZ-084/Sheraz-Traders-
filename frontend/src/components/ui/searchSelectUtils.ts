import type { SearchSelectOption } from './SearchSelect';

export function filterOptions(options: SearchSelectOption[], query: string): SearchSelectOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.label.toLowerCase().includes(q));
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
  if (filtered.length === 0) return null;
  if (filtered.length === 1) return filtered[0]!;

  if (mode === 'enter') {
    return filtered[highlightIndex] ?? filtered[0] ?? null;
  }

  if (highlightMovedByKeyboard && filtered[highlightIndex]) {
    return filtered[highlightIndex]!;
  }

  return null;
}
