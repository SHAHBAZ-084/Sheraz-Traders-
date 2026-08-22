/** Session-scoped payload cache so restored drafts survive React Strict Mode remounts. */
const restorePayloadCache = new Map<string, unknown>();

export function peekMinimizedRestorePayload<T>(id: string): T | null {
  const hit = restorePayloadCache.get(id);
  return hit != null ? (hit as T) : null;
}

export function stashMinimizedRestorePayload(id: string, payload: unknown) {
  restorePayloadCache.set(id, payload);
}

export function resolveMinimizedRestoreId(
  searchParams: URLSearchParams,
  locationState: { minimizedFormId?: string } | null | undefined,
): string | undefined {
  const fromQuery = searchParams.get('minimizedFormId');
  if (fromQuery) return fromQuery;
  return locationState?.minimizedFormId;
}
