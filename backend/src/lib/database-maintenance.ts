import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { getBackupDirectory, getDatabaseFilePath, ensureDatabaseDirectoryExists } from './database-path';
import { logger } from './logger';

const DEFAULT_BACKUP_RETENTION_DAYS = 30;

export async function configureSqlitePragmas(db: PrismaClient): Promise<void> {
  // PRAGMA statements return rows in SQLite — use $queryRaw, not $executeRaw.
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  await db.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
  await db.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
  await db.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
  logger.info('SQLite pragmas applied (WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000)');
}

export async function walCheckpointTruncate(db: PrismaClient): Promise<void> {
  await db.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
  logger.info('WAL checkpoint completed');
}

export type IntegrityCheckResult = {
  ok: boolean;
  results: string[];
};

export async function verifyDatabaseIntegrity(db: PrismaClient): Promise<IntegrityCheckResult> {
  const rows = await db.$queryRawUnsafe<{ integrity_check: string }[]>('PRAGMA integrity_check;');
  const results = rows.map((row) => row.integrity_check);
  const ok = results.length === 1 && results[0] === 'ok';
  return { ok, results };
}

export async function isDatabaseReadable(): Promise<boolean> {
  const dbPath = getDatabaseFilePath();
  try {
    await fs.promises.access(dbPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function databaseFileExists(): boolean {
  return fs.existsSync(getDatabaseFilePath());
}

function formatBackupName(date: Date): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `sheraztrader-${stamp}.db`;
}

export async function createDatabaseBackup(retentionDays = DEFAULT_BACKUP_RETENTION_DAYS): Promise<string | null> {
  ensureDatabaseDirectoryExists();
  const dbPath = getDatabaseFilePath();

  if (!fs.existsSync(dbPath)) {
    logger.info('Skipping backup — database file does not exist yet');
    return null;
  }

  const backupDir = getBackupDirectory();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const dest = path.join(backupDir, formatBackupName(new Date()));
  await fs.promises.copyFile(dbPath, dest);
  logger.info('Database backup created', { path: dest });

  await pruneOldBackups(backupDir, retentionDays);
  return dest;
}

async function pruneOldBackups(backupDir: string, retentionDays: number): Promise<void> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await fs.promises.readdir(backupDir);
  for (const name of entries) {
    if (!name.startsWith('sheraztrader-') || !name.endsWith('.db')) continue;
    const full = path.join(backupDir, name);
    const stat = await fs.promises.stat(full);
    if (stat.mtimeMs < cutoff) {
      await fs.promises.unlink(full);
      logger.info('Removed old database backup', { path: full });
    }
  }
}

export function scheduleWalCheckpoint(db: PrismaClient, intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    walCheckpointTruncate(db).catch((err) => {
      logger.error('Scheduled WAL checkpoint failed', { err: String(err) });
    });
  }, intervalMs);
}
