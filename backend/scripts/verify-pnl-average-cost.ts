/**
 * One-off: verify P&L cost resolution against a DB (historical self-correct check).
 * Usage: npx tsx backend/scripts/verify-pnl-average-cost.ts --db="C:/path/sheraztrader.db"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FinancialYearStatus } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

function argValue(flag: string) {
  const prefixed = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

for (const envPath of [path.join(backendRoot, '.env')]) {
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] == null) process.env[m[1]] = val;
  }
}

const dbOverride = argValue('--db');
if (dbOverride) {
  process.env.DATABASE_URL = dbOverride.startsWith('file:')
    ? dbOverride
    : `file:${dbOverride.replace(/\\/g, '/')}`;
}

async function main() {
  // Import after DATABASE_URL is set so prisma singleton picks it up.
  const { getProfitLossReport } = await import('../src/modules/accounting/profit-loss-report.service');
  const { verifyLedgerIntegrity } = await import('../src/modules/accounting/ledger-integrity');
  const { prisma } = await import('../src/lib/prisma');

  console.log('DATABASE_URL', process.env.DATABASE_URL);
  const fy = await prisma.financialYear.findFirst({ where: { status: FinancialYearStatus.ACTIVE } });
  if (!fy) throw new Error('No active FY');

  const report = await getProfitLossReport({ financialYearId: fy.id });
  const saleRows = report.rows.filter((r) => r.sourceType === 'SALE_INVOICE');
  const unavailable = saleRows.filter((r) => r.costUnavailable);
  const suspiciousFullSaleAsProfit = saleRows.filter(
    (r) =>
      !r.costUnavailable &&
      r.purchasePrice == null &&
      r.salePrice != null &&
      r.profit > 0,
  );

  const integrity = await verifyLedgerIntegrity();

  console.log(
    JSON.stringify(
      {
        financialYear: fy.label,
        saleRows: saleRows.length,
        costUnavailableCount: report.costUnavailableCount,
        unavailableSample: unavailable.slice(0, 10).map((r) => ({
          product: r.productName,
          salePrice: r.salePrice,
          note: r.note,
        })),
        suspiciousMissingCostButCountedProfit: suspiciousFullSaleAsProfit.length,
        sampleRows: saleRows.slice(0, 25).map((r) => ({
          product: r.productName,
          purchasePrice: r.purchasePrice,
          salePrice: r.salePrice,
          profit: r.profit,
          costUnavailable: r.costUnavailable,
        })),
        totalPurchase: report.totalPurchase,
        totalSale: report.totalSale,
        netProfit: report.netProfit,
        ledgerIntegrityOk: integrity.ok,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
