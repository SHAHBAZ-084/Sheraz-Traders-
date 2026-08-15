export type PaginatedResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type CursorPaginatedResult<T> = {
  items: T[];
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;
/** Upper bound for dropdown / selector endpoints that need most of a small master list. */
export const SELECTOR_MAX_PAGE_SIZE = 2000;

export type PaginationDefaults = {
  limit: number;
  max: number;
};

export const STANDARD_PAGINATION: PaginationDefaults = {
  limit: DEFAULT_PAGE_SIZE,
  max: MAX_PAGE_SIZE,
};

export const LEDGER_PAGINATION: PaginationDefaults = {
  limit: 200,
  max: 2000,
};

export const SELECTOR_PAGINATION: PaginationDefaults = {
  limit: SELECTOR_MAX_PAGE_SIZE,
  max: SELECTOR_MAX_PAGE_SIZE,
};

export function parsePagination(
  query: { limit?: string; offset?: string },
  defaults: PaginationDefaults = STANDARD_PAGINATION,
): { limit: number; offset: number } {
  const parsedLimit = parseInt(query.limit ?? String(defaults.limit), 10);
  const parsedOffset = parseInt(query.offset ?? '0', 10);
  const limit = Math.min(
    Math.max(Number.isFinite(parsedLimit) ? parsedLimit : defaults.limit, 1),
    defaults.max,
  );
  const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);
  return { limit, offset };
}

export function parseCursorPagination(
  query: { limit?: string; cursor?: string },
  defaults: PaginationDefaults = STANDARD_PAGINATION,
): { limit: number; cursor: number | null } {
  const { limit } = parsePagination(query, defaults);
  const cursorRaw = query.cursor?.trim();
  if (!cursorRaw) {
    return { limit, cursor: null };
  }
  const cursor = parseInt(cursorRaw, 10);
  return { limit, cursor: Number.isFinite(cursor) && cursor > 0 ? cursor : null };
}

export function paginateArray<T>(items: T[], limit: number, offset: number): PaginatedResult<T> {
  const total = items.length;
  const sliced = items.slice(offset, offset + limit);
  return {
    items: sliced,
    total,
    limit,
    offset,
  };
}

export function encodeEntryCursor(entryId: number): string {
  return String(entryId);
}
