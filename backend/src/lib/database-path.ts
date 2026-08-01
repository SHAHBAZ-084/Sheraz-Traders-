import fs from 'fs';
import path from 'path';

/** Resolve the on-disk SQLite file from DATABASE_URL (file:…). */
export function getDatabaseFilePath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/sheraztrader.db';
  const raw = url.replace(/^file:/, '');
  if (path.isAbsolute(raw)) return raw;
  // Match Prisma: relative SQLite paths resolve from the prisma/ schema directory.
  const backendRoot = path.resolve(__dirname, '../..');
  return path.resolve(backendRoot, 'prisma', raw);
}

export function getBackupDirectory(): string {
  const dbPath = getDatabaseFilePath();
  return path.join(path.dirname(dbPath), 'backups');
}

export function getLogDirectory(): string {
  const dbPath = getDatabaseFilePath();
  return path.join(path.dirname(dbPath), 'logs');
}

export function ensureDatabaseDirectoryExists(): void {
  const dbPath = getDatabaseFilePath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
