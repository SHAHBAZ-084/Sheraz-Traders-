import { Prisma, PrismaClient } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Matches JS `/^\d+$/` — every character is an ASCII digit (includes leading zeros). */
const PURE_DIGIT_CODE_SQL = Prisma.sql`
  length(code) > 0
  AND length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    code, '0',''), '1',''), '2',''), '3',''), '4',''), '5',''), '6',''), '7',''), '8',''), '9','')) = 0
`;

/**
 * Largest numeric account code (parseInt semantics), skipping non-numeric codes.
 * Uses a single aggregate query instead of loading every account row.
 */
export async function maxNumericAccountCode(client: DbClient): Promise<number> {
  const rows = await client.$queryRaw<{ maxCode: number | bigint | null }[]>`
    SELECT MAX(CAST(code AS INTEGER)) AS maxCode
    FROM Account
    WHERE ${PURE_DIGIT_CODE_SQL}
  `;
  const raw = rows[0]?.maxCode;
  if (raw == null) return 0;
  const num = typeof raw === 'bigint' ? Number(raw) : raw;
  return Number.isFinite(num) ? num : 0;
}

export async function generateNextAccountCode(client: DbClient): Promise<string> {
  const max = await maxNumericAccountCode(client);
  return String(max + 1);
}

export function isAccountCodeConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; meta?: { target?: string[] | string } };
  if (e.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes('code');
  if (typeof target === 'string') return target.includes('code');
  return true;
}
