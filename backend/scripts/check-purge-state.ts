import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const migrations = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at',
  );
  console.log('applied', migrations.map((m) => m.migration_name));

  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND (
      name LIKE '%Bardana%' OR name LIKE '%PurchaseMaal%' OR name LIKE '%SalePaunch%' OR name LIKE '%SaleCommission%'
    )`,
  );
  console.log('leftover tables', tables);

  const prefsCols = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `PRAGMA table_info('SystemPreference')`,
  );
  console.log(
    'prefs columns',
    prefsCols.map((c) => (c as { name: string }).name),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
