import { execSync } from 'child_process';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  configureSqlitePragmas,
  createDatabaseBackup,
  databaseFileExists,
  isDatabaseReadable,
  scheduleWalCheckpoint,
  verifyDatabaseIntegrity,
  walCheckpointTruncate,
} from './database-maintenance';
import { ensureDatabaseDirectoryExists } from './database-path';
import { logger } from './logger';

export type StartupStatus = {
  ok: boolean;
  databaseExists: boolean;
  migrationsApplied: boolean;
  integrityOk: boolean;
  error?: string;
};

let checkpointTimer: NodeJS.Timeout | null = null;

export async function runMigrations(): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.SKIP_MIGRATIONS === '1') {
    return;
  }

  const backendRoot = path.resolve(__dirname, '../..');
  logger.info('Running prisma migrate deploy…');
  execSync('npx prisma migrate deploy', {
    cwd: backendRoot,
    stdio: 'pipe',
    env: process.env,
  });
  logger.info('Database migrations up to date');
}

export async function initializeDatabase(db: PrismaClient): Promise<StartupStatus> {
  ensureDatabaseDirectoryExists();

  const status: StartupStatus = {
    ok: false,
    databaseExists: databaseFileExists(),
    migrationsApplied: false,
    integrityOk: true,
  };

  try {
    await runMigrations();
    status.migrationsApplied = true;

    await configureSqlitePragmas(db);

    if (status.databaseExists && process.env.NODE_ENV === 'production') {
      await createDatabaseBackup();
      const integrity = await verifyDatabaseIntegrity(db);
      status.integrityOk = integrity.ok;
      if (!integrity.ok) {
        logger.warn('Database integrity check failed on startup', { results: integrity.results });
      }
    } else if (status.databaseExists && process.env.NODE_ENV !== 'test') {
      const integrity = await verifyDatabaseIntegrity(db);
      status.integrityOk = integrity.ok;
    }

    const readable = status.databaseExists ? await isDatabaseReadable() : true;
    if (!readable) {
      status.error = 'Database file is not readable';
      return status;
    }

    if (checkpointTimer) clearInterval(checkpointTimer);
    checkpointTimer = scheduleWalCheckpoint(db);

    status.ok = true;
    return status;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Database initialization failed', { error: message });
    status.error = message;
    return status;
  }
}

export async function shutdownDatabase(db: PrismaClient): Promise<void> {
  if (checkpointTimer) {
    clearInterval(checkpointTimer);
    checkpointTimer = null;
  }
  try {
    await walCheckpointTruncate(db);
  } catch (err) {
    logger.warn('WAL checkpoint on shutdown failed', { err: String(err) });
  }
  await db.$disconnect();
}
