import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('Usage: npx tsx scripts/inspect-average-cost-dbs.ts <file:...> [...]');
  process.exit(1);
}

async function inspect(url: string) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const total = await prisma.product.count();
    const withCost = await prisma.product.count({ where: { averageCost: { not: null } } });
    const nullCost = await prisma.product.count({ where: { averageCost: null } });
    const cats = await prisma.productCategory.findMany({ select: { id: true, name: true } });
    const sales = await prisma.invoice.count({ where: { type: 'SALE_INVOICE', status: 'POSTED' } });
    const purchases = await prisma.invoice.count({
      where: { type: 'PURCHASE_INVOICE', status: 'POSTED' },
    });
    const stockAdj = await prisma.stockMovement.count({
      where: { invoiceReference: 'Stock Adjustment', direction: 'IN' },
    });

    const soldWithNull = await prisma.$queryRaw<
      Array<{
        id: number;
        name: string;
        code: string;
        category: string | null;
        saleLines: bigint | number;
      }>
    >`
      SELECT p.id, p.name, p.code, c.name as category,
        (SELECT COUNT(*) FROM InvoiceItem ii
          JOIN Invoice i ON i.id = ii.invoiceId
          WHERE ii.productId = p.id AND i.type = 'SALE_INVOICE' AND i.status = 'POSTED') as saleLines
      FROM Product p
      LEFT JOIN ProductCategory c ON c.id = p.categoryId
      WHERE p.averageCost IS NULL
      ORDER BY saleLines DESC, p.id
      LIMIT 20
    `;

    const withCostSample = await prisma.product.findMany({
      where: { averageCost: { not: null } },
      take: 15,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        averageCost: true,
        category: { select: { name: true } },
      },
    });

    console.log(
      JSON.stringify(
        {
          url,
          total,
          withCost,
          nullCost,
          sales,
          purchases,
          stockAdj,
          categories: cats,
          nullCostSoldSample: soldWithNull.map((r) => ({
            ...r,
            saleLines: Number(r.saleLines),
          })),
          withCostSample: withCostSample.map((p) => ({
            id: p.id,
            name: p.name,
            code: p.code,
            averageCost: Number(p.averageCost),
            category: p.category?.name ?? null,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  for (const url of urls) {
    const normalized = url.startsWith('file:') ? url : `file:${url.replace(/\\/g, '/')}`;
    await inspect(normalized);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
