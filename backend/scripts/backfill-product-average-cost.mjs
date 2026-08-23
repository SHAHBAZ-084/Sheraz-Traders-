/**
 * Thin wrapper — production backfill runs automatically on app startup.
 * Prefer: npx tsx backend/scripts/backfill-product-average-cost-cli.ts [--apply]
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, 'backfill-product-average-cost-cli.ts');
const result = spawnSync(
  'npx',
  ['tsx', cli, ...process.argv.slice(2)],
  { stdio: 'inherit', shell: true, cwd: path.resolve(__dirname, '../..') },
);
process.exit(result.status ?? 1);
