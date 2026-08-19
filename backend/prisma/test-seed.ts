/**
 * DEV/TEST ONLY — sample data for end-to-end app testing.
 *
 * Data source: prisma/test-seed-data.json
 *
 * Does NOT run automatically. Invoke manually after the normal seed:
 *   npm run db:seed -w backend
 *   npm run db:seed:test -w backend
 *
 * Refuses to run when SHERAZ_TRADERS_PACKAGED=1 (packaged desktop app).
 */
import { prisma } from '../src/lib/prisma';
import { runDevSeed } from './dev-seed-lib';
import { assertDevSeedSafeToRun } from '../src/lib/seed-guard';

function assertSafeToRun() {
  assertDevSeedSafeToRun('Test seed');
}

async function main() {
  assertSafeToRun();
  await runDevSeed({
    dataFile: 'test-seed-data.json',
    markerAccount: 'HBL Main Branch',
    billPrefix: 'TEST',
    seedLabel: 'Test seed',
    forceEnvVar: 'FORCE_TEST_SEED',
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
