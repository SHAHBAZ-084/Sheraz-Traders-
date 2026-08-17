/**
 * DEV/TEST ONLY — large sample dataset for pagination, reports, and ledger stress testing.
 *
 * Data source: prisma/big-seed-data.json
 *
 * Does NOT run automatically. Invoke manually after the normal seed:
 *   npm run db:seed -w backend
 *   npm run db:seed:big -w backend
 *
 * Refuses to run when SHERAZ_TRADERS_PACKAGED=1 (packaged desktop app).
 */
import { prisma } from '../src/lib/prisma';
import { runDevSeed } from './dev-seed-lib';

function assertSafeToRun() {
  if (process.env.SHERAZ_TRADERS_PACKAGED === '1') {
    console.error('Big seed cannot run inside the packaged Sheeraz Traders application.');
    process.exit(1);
  }
}

async function main() {
  assertSafeToRun();
  await runDevSeed({
    dataFile: 'big-seed-data.json',
    markerAccount: 'Meezan Bank Chishtian',
    billPrefix: 'BIG',
    seedLabel: 'Big seed',
    forceEnvVar: 'FORCE_BIG_SEED',
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
