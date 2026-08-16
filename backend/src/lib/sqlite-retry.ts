const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_BASE_DELAY_MS = 50;
const DEFAULT_MAX_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** True for SQLite lock contention that may succeed on retry (WAL + busy_timeout can still race). */
export function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  if (code === 'P2034' || code === 'P1008') return true;
  const msg = errorMessage(error);
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|Timed out fetching a new connection/i.test(msg);
}

/**
 * Retries work when SQLite reports lock/busy/deadlock. Correctness-sensitive paths
 * should still keep transactions short; this avoids surfacing transient contention as 500s.
 */
export async function withSqliteRetry<T>(
  work: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (!isSqliteBusyError(error) || attempt >= maxAttempts) throw error;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}
