/**
 * Dev/debug CLI for Product.averageCost backfill.
 *
 * Production: the same logic runs automatically on every app start via
 * `backfillNullProductAverageCosts()` in backend/src/index.ts (deferred setImmediate).
 * Do not rely on this script to fix a shop install — the .exe already does it.
 *
 * Usage:
 *   npx tsx backend/scripts/backfill-product-average-cost-cli.ts
 *   npx tsx backend/scripts/backfill-product-average-cost-cli.ts --apply
 *   npx tsx backend/scripts/backfill-product-average-cost-cli.ts --db="file:C:/path/to/copy.db" --apply
 *
 * Or: node backend/scripts/backfill-product-average-cost.mjs [--apply] [--db=...]
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import {
  backfillNullProductAverageCosts,
  planProductAverageCostBackfill,
} from '../src/modules/products/backfill-product-average-cost';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');
const apply = process.argv.includes('--apply');

function argValue(flag: string) {
  const prefixed = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function loadEnv() {
  for (const envPath of [
    path.join(backendRoot, '.env'),
    path.join(repoRoot, 'backend', '.env'),
  ]) {
    if (!fs.existsSync(envPath)) continue;
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
}

loadEnv();

const dbOverride = argValue('--db');
if (dbOverride) {
  process.env.DATABASE_URL = dbOverride.startsWith('file:')
    ? dbOverride
    : `file:${dbOverride.replace(/\\/g, '/')}`;
}

const prisma = new PrismaClient();

async function main() {
  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        databaseUrl: process.env.DATABASE_URL ?? '(unset)',
        note: 'Only Product.averageCost is updated; ledgers/balances are never modified. Production applies this automatically on app startup.',
      },
      null,
      2,
    ),
  );

  if (!apply) {
    const plan = await planProductAverageCostBackfill(prisma);
    console.log(JSON.stringify(plan, null, 2));
    console.log('\nDry-run only. Re-run with --apply to write Product.averageCost values.');
    return;
  }

  const result = await backfillNullProductAverageCosts(prisma);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
