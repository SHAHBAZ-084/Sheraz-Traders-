import path from 'path';
import { getDatabaseFilePath } from './database-path';

/** AppData install locations — never run dev/test seed against these. */
const PRODUCTION_DB_PATH_MARKERS = [
  `${path.sep}AppData${path.sep}Roaming${path.sep}Sheeraz Traders${path.sep}`,
  `${path.sep}AppData${path.sep}Roaming${path.sep}Sheraz Traders${path.sep}`,
  `${path.sep}AppData${path.sep}Roaming${path.sep}grain-market-pos${path.sep}`,
  `${path.sep}AppData${path.sep}Roaming${path.sep}Grain Market POS${path.sep}`,
] as const;

export function isProductionDatabasePath(dbPath: string): boolean {
  const normalized = path.resolve(dbPath);
  return PRODUCTION_DB_PATH_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * Refuse dev/test/big seed when pointed at a packaged app or production userData DB.
 * Call at the start of every manual seed script.
 */
export function assertDevSeedSafeToRun(label: string): void {
  if (process.env.SHERAZ_TRADERS_PACKAGED === '1') {
    console.error(`${label} cannot run inside the packaged Sheeraz Traders application.`);
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production') {
    console.error(`${label} cannot run with NODE_ENV=production.`);
    process.exit(1);
  }

  const dbPath = getDatabaseFilePath();
  if (isProductionDatabasePath(dbPath)) {
    console.error(
      `${label} refused: database path looks like production userData:\n  ${dbPath}\n` +
        'Point DATABASE_URL at a dev/test database instead.',
    );
    process.exit(1);
  }
}
