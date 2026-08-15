/**
 * Dev utility: run EXPLAIN QUERY PLAN against common accounting queries.
 * Usage (from backend/): npx tsx scripts/explain-query-plan.ts
 */
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient, VoucherStatus } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function explain(label: string, sql: string) {
  console.log(`\n=== ${label} ===`);
  const rows = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN QUERY PLAN ${sql}`);
  for (const row of rows) {
    console.log(row['QUERY PLAN']);
  }
}

async function main() {
  const ledger = await prisma.ledger.findFirst({ select: { id: true } });
  const account = await prisma.account.findFirst({ select: { id: true, categoryId: true } });
  const year = await prisma.financialYear.findFirst({ select: { id: true } });

  if (!ledger || !account || !year) {
    console.log('Seed the database first (npm run db:seed).');
    return;
  }

  await explain(
    'Ledger entries for account/year',
    `SELECT le.* FROM LedgerEntry le
     INNER JOIN Ledger l ON l.id = le.ledgerId
     WHERE l.accountId = ${account.id}
       AND le.isReversal = 0
     ORDER BY le.id ASC`,
  );

  await explain(
    'Vouchers by financial year',
    `SELECT * FROM Voucher
     WHERE financialYearId = ${year.id} AND status = '${VoucherStatus.ACTIVE}'
     ORDER BY date DESC, number DESC
     LIMIT 200`,
  );

  await explain(
    'Invoices list',
    `SELECT * FROM Invoice
     WHERE financialYearId = ${year.id}
     ORDER BY createdAt DESC
     LIMIT 200`,
  );

  await explain(
    'Account balances by category',
    `SELECT a.id, a.categoryId FROM Account a
     WHERE a.isActive = 1 AND a.categoryId = ${account.categoryId}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
