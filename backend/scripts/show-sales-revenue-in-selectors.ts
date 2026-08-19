/**
 * One-time repair: make Sales Revenue selectable in vouchers, ledgers, and reports.
 *
 * Does not run automatically. Dry-run by default; pass --confirm to apply.
 *
 * Usage:
 *   npx tsx scripts/show-sales-revenue-in-selectors.ts
 *   npx tsx scripts/show-sales-revenue-in-selectors.ts --confirm
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const confirm = process.argv.includes('--confirm');

const REVENUE_ACCOUNT_NAMES = ['Sales Revenue', 'Sale Revenue'] as const;

async function main() {
  const accounts = await prisma.account.findMany({
    where: {
      excludeFromSelectors: true,
      OR: [
        { name: { in: [...REVENUE_ACCOUNT_NAMES] } },
        { category: { name: { equals: 'Revenue' } } },
      ],
    },
    select: { id: true, name: true, code: true, excludeFromSelectors: true },
  });

  if (accounts.length === 0) {
    console.log('No Revenue accounts still hidden from selectors.');
    return;
  }

  console.log(
    confirm ? 'Updating:' : 'Dry-run (pass --confirm to apply):',
    accounts.map((a) => `${a.name} (${a.code ?? 'no code'})`).join(', '),
  );

  if (!confirm) return;

  const result = await prisma.account.updateMany({
    where: { id: { in: accounts.map((a) => a.id) } },
    data: { excludeFromSelectors: false },
  });
  console.log(`Updated ${result.count} account(s). excludeFromSelectors is now false.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
