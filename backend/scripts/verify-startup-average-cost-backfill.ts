/**
 * One-off verification: simulate a shop DB with null averageCost + real history,
 * run the same startup backfill twice, assert only Product.averageCost changes.
 *
 * Usage: npx tsx backend/scripts/verify-startup-average-cost-backfill.ts
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import {
  backfillNullProductAverageCosts,
} from '../src/modules/products/backfill-product-average-cost';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const copyPath = path.join(__dirname, '_shop-sim-average-cost.db');
const sourceCandidates = [
  path.join(process.env.APPDATA ?? '', 'Sheraz Traders', 'data', 'sheraztrader.db'),
  path.resolve(__dirname, '../prisma/data/sheraztrader.db'),
];

function findSource() {
  for (const p of sourceCandidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('No source sheraztrader.db found to copy');
}

async function fingerprint(db: InstanceType<typeof PrismaClient>) {
  const [ledgerSum, stockCount, voucherCount, avgCosts] = await Promise.all([
    db.$queryRawUnsafe(`SELECT ROUND(SUM(balance), 8) AS s FROM Ledger`) as Promise<Array<{ s: number | null }>>,
    db.stockMovement.count(),
    db.voucher.count(),
    db.product.findMany({
      select: { id: true, averageCost: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  return {
    ledgerSum: Number(ledgerSum[0]?.s ?? 0),
    stockCount,
    voucherCount,
    avgCostById: Object.fromEntries(
      avgCosts.map((p) => [p.id, p.averageCost == null ? null : Number(p.averageCost)]),
    ),
  };
}

async function main() {
  const source = findSource();
  fs.copyFileSync(source, copyPath);
  // Also copy WAL/SHM if present so we get a consistent snapshot when possible
  for (const suffix of ['-wal', '-shm']) {
    const side = `${source}${suffix}`;
    if (fs.existsSync(side)) fs.copyFileSync(side, `${copyPath}${suffix}`);
  }

  const url = `file:${copyPath.replace(/\\/g, '/')}`;
  const db = new PrismaClient({ datasources: { db: { url } } });

  try {
    // Simulate shop: clear averageCost on products that have posted purchase history.
    const withPurchases = await db.invoiceItem.findMany({
      where: { invoice: { type: 'PURCHASE_INVOICE', status: 'POSTED' }, productId: { not: null } },
      select: { productId: true },
      distinct: ['productId'],
    });
    const productIds = withPurchases
      .map((r) => r.productId)
      .filter((id): id is number => id != null);

    if (productIds.length === 0) {
      // Fallback: clear all that currently have a cost so we can still exercise the path
      await db.product.updateMany({ data: { averageCost: null } });
    } else {
      await db.product.updateMany({
        where: { id: { in: productIds } },
        data: { averageCost: null },
      });
    }

    const nullBefore = await db.product.count({ where: { averageCost: null } });
    const before = await fingerprint(db);

    const first = await backfillNullProductAverageCosts(db);
    const mid = await fingerprint(db);
    const second = await backfillNullProductAverageCosts(db);
    const after = await fingerprint(db);

    const report = {
      source,
      copyPath,
      nullBefore,
      firstRun: { updated: first.updated, skippedNeedsHistory: first.skippedNeedsHistory },
      secondRun: { updated: second.updated },
      unchangedExceptAverageCost: {
        ledgerSum: before.ledgerSum === after.ledgerSum,
        stockCount: before.stockCount === after.stockCount,
        voucherCount: before.voucherCount === after.voucherCount,
      },
      sampleUpdates: first.updates.slice(0, 10),
      averageCostChanged:
        JSON.stringify(before.avgCostById) !== JSON.stringify(mid.avgCostById),
      secondRunNoFurtherChange:
        JSON.stringify(mid.avgCostById) === JSON.stringify(after.avgCostById),
    };

    console.log(JSON.stringify(report, null, 2));

    if (first.updated === 0 && nullBefore > 0 && first.skippedNeedsHistory === nullBefore) {
      console.warn('No products had recoverable history — shop-sim may be sparse.');
    }
    if (before.ledgerSum !== after.ledgerSum || before.stockCount !== after.stockCount) {
      throw new Error('Backfill changed ledger or stock — abort');
    }
    if (second.updated !== 0) {
      throw new Error('Second run was not idempotent');
    }
    console.log('\nOK: shop-sim backfill is idempotent and averageCost-only.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
