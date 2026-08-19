/**
 * Deactivate confirmed dev/test seed Bank accounts (soft-delete: isActive=false).
 *
 * SAFETY: Refuses to run against AppData production paths unless ALLOW_PRODUCTION_CLEANUP=1.
 * Always dry-run by default — pass --confirm to apply.
 *
 * Usage:
 *   DATABASE_URL="file:./data/sheraztrader.db" npx tsx scripts/deactivate-seed-bank-accounts.ts
 *   DATABASE_URL="file:./data/sheraztrader.db" npx tsx scripts/deactivate-seed-bank-accounts.ts --confirm
 */
import { PrismaClient } from '@prisma/client';
import { getDatabaseFilePath } from '../src/lib/database-path';
import { isProductionDatabasePath } from '../src/lib/seed-guard';
import { verifyLedgerIntegrity } from '../src/modules/accounting/accounting.service';

/** Exact bank names from test-seed-data.json / big-seed-data.json — not shop-specific custom names. */
const SEED_BANK_NAMES = [
  'HBL Main Branch',
  'UBL Chishtian',
  'MCB Bahawalnagar',
  'Allied Bank Fort Abbas',
  'Bank Alfalah Chishtian',
  'Meezan Bank Chishtian',
  'Faysal Bank Bahawalnagar',
  'Bank of Punjab Chishtian',
  'Askari Bank Chishtian',
  'National Bank Fort Abbas',
] as const;

const TEST_NAME_PATTERNS = [
  /^Approval /i,
  /^Pending Acct Adj /i,
  /^Pending Account /i,
  /^Wrong Endpoint Adj /i,
  /^Adj Standard Product/i,
  /^Adj Store /i,
  /^APP-EXP-/i,
  /^APP-SP-/i,
  /^APP-PP-/i,
];

function isConfirmedTestAccount(name: string): boolean {
  if ((SEED_BANK_NAMES as readonly string[]).includes(name)) return true;
  return TEST_NAME_PATTERNS.some((re) => re.test(name));
}

function isBankOrCashCategory(name: string) {
  const n = name.trim().toLowerCase();
  return n.includes('bank') || n.includes('cash');
}

const confirm = process.argv.includes('--confirm');
const db = new PrismaClient();

async function main() {
  const dbPath = getDatabaseFilePath();
  console.log('Database:', dbPath);
  console.log('Mode:', confirm ? 'APPLY (deactivate)' : 'DRY RUN');

  if (isProductionDatabasePath(dbPath) && process.env.ALLOW_PRODUCTION_CLEANUP !== '1') {
    console.error(
      'Refused: this looks like a production userData database.\n' +
        'If you have verified specific accounts with the shop owner, re-run with ALLOW_PRODUCTION_CLEANUP=1.',
    );
    process.exit(1);
  }

  const rows = await db.$queryRawUnsafe<
    Array<{
      id: number;
      name: string;
      code: string;
      categoryName: string;
      balance: number | null;
      isActive: number;
    }>
  >(`
    SELECT a.id, a.name, a.code, c.name AS categoryName, l.balance, a.isActive
    FROM Account a
    JOIN AccountCategory c ON c.id = a.categoryId
    LEFT JOIN Ledger l ON l.accountId = a.id
    WHERE a.isActive = 1
    ORDER BY c.name, a.name
  `);

  const candidates = rows.filter(
    (r) => isBankOrCashCategory(r.categoryName) && isConfirmedTestAccount(r.name) && r.name !== 'Cash in Hand',
  );

  if (candidates.length === 0) {
    console.log('No confirmed test Bank/Cash accounts to deactivate.');
    return;
  }

  console.log('\nCandidates to deactivate:');
  for (const c of candidates) {
    console.log(`  [${c.id}] ${c.code} ${c.categoryName} / ${c.name} balance=${Number(c.balance ?? 0).toFixed(2)}`);
  }

  if (!confirm) {
    console.log('\nDry run only. Re-run with --confirm to deactivate these accounts.');
    return;
  }

  for (const c of candidates) {
    await db.$executeRawUnsafe(`UPDATE Account SET isActive = 0 WHERE id = ?`, c.id);
    console.log(`Deactivated account id=${c.id} (${c.name})`);
  }

  const integrity = await verifyLedgerIntegrity();
  console.log('\nverifyLedgerIntegrity:', integrity.ok ? 'OK' : 'FAILED', integrity.results);

  const bankCash = await db.$queryRawUnsafe<Array<{ name: string; balance: number | null }>>(`
    SELECT a.name, l.balance
    FROM Account a
    JOIN AccountCategory c ON c.id = a.categoryId
    LEFT JOIN Ledger l ON l.accountId = a.id
    WHERE a.isActive = 1
      AND (LOWER(c.name) LIKE '%bank%' OR LOWER(c.name) LIKE '%cash%')
  `);
  const total = bankCash.reduce((s, r) => s + Number(r.balance ?? 0), 0);
  console.log('\nRemaining active Bank/Cash accounts:');
  for (const r of bankCash) {
    console.log(`  ${r.name}: ${Number(r.balance ?? 0).toFixed(2)}`);
  }
  console.log(`Dashboard cashBalance sum: ${total.toFixed(2)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
