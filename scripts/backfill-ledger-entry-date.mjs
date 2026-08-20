/**
 * Dry-run / apply helper for LedgerEntry.date backfill.
 *
 * Usage:
 *   node scripts/backfill-ledger-entry-date.mjs              # dry-run against DATABASE_URL
 *   node scripts/backfill-ledger-entry-date.mjs --apply      # write dates (migration normally does this)
 *
 * Prefer running the Prisma migration; this script is for reviewing before/after
 * on a DB copy when the column already exists (nullable or populated).
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');

function loadEnv() {
  const envPath = path.join(root, 'backend', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

loadEnv();

const prisma = new PrismaClient();

function dayKey(d) {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
}

async function main() {
  const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("LedgerEntry")`);
  const hasDate = cols.some((c) => c.name === 'date');
  if (!hasDate) {
    console.log('LedgerEntry.date column not present yet — run prisma migrate deploy first.');
    return;
  }

  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      le.id,
      le.voucherId,
      le.isOpeningBalance,
      le.createdAt,
      le.date AS currentDate,
      le.notes,
      v.date AS voucherDate,
      v.type AS voucherType,
      v.number AS voucherNumber
    FROM LedgerEntry le
    LEFT JOIN Voucher v ON v.id = le.voucherId
    ORDER BY le.id ASC
  `);

  let wouldChange = 0;
  const samples = [];

  for (const row of rows) {
    const resolved = row.voucherId != null ? row.voucherDate : row.createdAt;
    const before = dayKey(row.currentDate);
    const after = dayKey(resolved);
    if (before !== after) {
      wouldChange += 1;
      if (samples.length < 25) {
        samples.push({
          id: row.id,
          voucherId: row.voucherId,
          isOpeningBalance: !!row.isOpeningBalance,
          notes: row.notes,
          before,
          after,
          voucherType: row.voucherType,
          voucherNumber: row.voucherNumber,
        });
      }
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    totalEntries: rows.length,
    rowsWhoseDateWouldChange: wouldChange,
    sampleBeforeAfter: samples,
    note: 'Amounts/accounts are never modified — only LedgerEntry.date.',
  }, null, 2));

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to write resolved dates.');
    return;
  }

  await prisma.$executeRawUnsafe(`
    UPDATE "LedgerEntry"
    SET "date" = (
      SELECT "Voucher"."date"
      FROM "Voucher"
      WHERE "Voucher"."id" = "LedgerEntry"."voucherId"
    )
    WHERE "voucherId" IS NOT NULL
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE "LedgerEntry"
    SET "date" = "createdAt"
    WHERE "voucherId" IS NULL
  `);
  console.log('Backfill applied.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
