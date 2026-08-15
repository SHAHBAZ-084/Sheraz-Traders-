/** Page size for browsing tables and report lists (not SearchSelect dropdowns). */
export const BROWSE_PAGE_SIZE = 25;

export function browsePageCount(total: number, pageSize = BROWSE_PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function browsePageRange(offset: number, total: number, pageSize = BROWSE_PAGE_SIZE) {
  if (total <= 0) return { from: 0, to: 0 };
  return {
    from: offset + 1,
    to: Math.min(offset + pageSize, total),
  };
}
