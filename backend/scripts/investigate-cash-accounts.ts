/**
 * Read-only investigation via raw SQL (works on older production schemas).
 * Usage: DATABASE_URL="file:/path/to/sheraztrader.db" npx tsx scripts/investigate-cash-accounts.ts
 */
import { PrismaClient } from '@prisma/client';

function isBankOrCashCategory(name: string) {
  const n = name.trim().toLowerCase();
  return n.includes('bank') || n.includes('cash');
}

const SEED_BANK_NAMES = new Set([
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
]);

const TEST_NAME_PATTERNS = [
  /^Approval /i,
  /^Pending /i,
  /^Wrong Endpoint /i,
  /^Adj /i,
  /^APP-/i,
  /\$\{Date\.now\(\)\}/,
  / \d{13,}$/,
  /^Test /i,
];

function classifyAccount(name: string): 'seed-bank' | 'test-pattern' | 'system' | 'unknown-real' {
  if (name === 'Cash in Hand') return 'system';
  if (SEED_BANK_NAMES.has(name)) return 'seed-bank';
  if (TEST_NAME_PATTERNS.some((re) => re.test(name))) return 'test-pattern';
  return 'unknown-real';
}

type Row = {
  id: number;
  code: string;
  name: string;
  isActive: number;
  createdAt: string;
  categoryId: number;
  categoryName: string;
  balance: number | null;
};

const db = new PrismaClient();

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? '(default from .env)';
  console.log('DATABASE_URL:', dbUrl);
  console.log('---\n');

  const categories = await db.$queryRawUnsafe<Array<{ id: number; name: string; isActive: number }>>(
    `SELECT id, name, isActive FROM AccountCategory WHERE isActive = 1 ORDER BY name`,
  );

  const bankCashCats = categories.filter((c) => isBankOrCashCategory(c.name));
  console.log('Bank/Cash-like categories (active):');
  for (const cat of bankCashCats) {
    const count = await db.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT COUNT(*) as c FROM Account WHERE isActive = 1 AND categoryId = ?`,
      cat.id,
    );
    console.log(`  [${cat.id}] "${cat.name}" — ${Number(count[0]?.c ?? 0)} active account(s)`);
  }
  console.log('');

  const nameCounts = new Map<string, typeof categories>();
  for (const c of categories) {
    const key = c.name.trim().toLowerCase();
    if (!nameCounts.has(key)) nameCounts.set(key, []);
    nameCounts.get(key)!.push(c);
  }
  const dupes = [...nameCounts.entries()].filter(([, rows]) => rows.length > 1);
  if (dupes.length > 0) {
    console.log('WARNING: duplicate category names (case-insensitive):');
    for (const [name, rows] of dupes) {
      if (isBankOrCashCategory(name)) {
        console.log(
          `  "${name}":`,
          rows.map((r) => `[${r.id}] "${r.name}"`).join(', '),
        );
      }
    }
    console.log('');
  }

  const rows = await db.$queryRawUnsafe<Row[]>(`
    SELECT
      a.id,
      a.code,
      a.name,
      a.isActive,
      a.createdAt,
      a.categoryId,
      c.name AS categoryName,
      l.balance AS balance
    FROM Account a
    JOIN AccountCategory c ON c.id = a.categoryId
    LEFT JOIN Ledger l ON l.accountId = a.id
    WHERE a.isActive = 1
    ORDER BY c.name, a.name
  `);

  const bankCash = rows.filter((r) => isBankOrCashCategory(r.categoryName));
  let total = 0;

  console.log('Active Bank/Cash accounts (dashboard cashBalance contributors):');
  console.log('id\tcode\tbalance\tcreatedAt\tcategory\tclassification\tname');
  for (const a of bankCash) {
    const bal = a.balance != null ? Number(a.balance) : 0;
    total += bal;
    const cls = classifyAccount(a.name);
    console.log(
      `${a.id}\t${a.code}\t${bal.toFixed(2)}\t${a.createdAt}\t${a.categoryName}\t${cls}\t${a.name}`,
    );
  }
  console.log(`\nSum of active Bank/Cash ledger balances: ${total.toFixed(2)}`);
  console.log(`Total active accounts in DB: ${rows.length}`);

  const seedBanks = bankCash.filter((a) => classifyAccount(a.name) === 'seed-bank');
  const testPattern = bankCash.filter((a) => classifyAccount(a.name) === 'test-pattern');
  const system = bankCash.filter((a) => classifyAccount(a.name) === 'system');
  const unknown = bankCash.filter((a) => classifyAccount(a.name) === 'unknown-real');

  console.log('\n--- Summary by classification ---');
  console.log(`System (keep): ${system.map((a) => a.name).join(', ') || '(none)'}`);
  console.log(
    `Likely test-seed banks (${seedBanks.length}):`,
    seedBanks.map((a) => `${a.name} (${Number(a.balance).toFixed(2)})`).join('; ') || '(none)',
  );
  console.log(
    `Test-pattern names (${testPattern.length}):`,
    testPattern.map((a) => `${a.name} (${Number(a.balance).toFixed(2)})`).join('; ') || '(none)',
  );
  console.log(
    `Unclassified / verify with shop owner (${unknown.length}):`,
    unknown.map((a) => `${a.name} (${Number(a.balance).toFixed(2)})`).join('; ') || '(none)',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
