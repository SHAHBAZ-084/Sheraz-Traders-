export type PaginatedResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export function parsePagination(
  query: { limit?: string; offset?: string },
  defaults: { limit: number; max: number } = { limit: 200, max: 500 },
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
