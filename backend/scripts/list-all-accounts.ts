/**
 * List ALL accounts (active + inactive) in a database.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  const rows = await db.$queryRawUnsafe<
    Array<{
      id: number;
      code: string;
      name: string;
      isActive: number;
      categoryName: string;
      balance: number | null;
      createdAt: string;
    }>
  >(`
    SELECT a.id, a.code, a.name, a.isActive, c.name AS categoryName, l.balance, a.createdAt
    FROM Account a
    JOIN AccountCategory c ON c.id = a.categoryId
    LEFT JOIN Ledger l ON l.accountId = a.id
    ORDER BY a.isActive DESC, c.name, a.name
  `);
  console.log(`Total accounts: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `[${r.isActive ? 'active' : 'INACTIVE'}] id=${r.id} ${r.code} ${r.categoryName} / ${r.name} bal=${r.balance ?? 0} created=${r.createdAt}`,
    );
  }
}

main().finally(() => db.$disconnect());
