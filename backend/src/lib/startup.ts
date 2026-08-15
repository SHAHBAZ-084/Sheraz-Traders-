import { execSync } from 'child_process';
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
import { ensureDatabaseDirectoryExists, getBackendRoot } from './database-path';
import { logger } from './logger';
import { applyMigrationsProgrammatically } from './programmatic-migrations';

export type StartupStatus = {
  ok: boolean;
  databaseExists: boolean;
  migrationsApplied: boolean;
  integrityOk: boolean;
  error?: string;
};

let checkpointTimer: NodeJS.Timeout | null = null;

export async function runMigrations(db?: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.SKIP_MIGRATIONS === '1') {
    return;
  }

  // Packaged Electron has no npx/prisma CLI — apply SQL migrations in-process.
  if (process.env.NODE_ENV === 'production' && db) {
    logger.info('Applying database migrations programmatically (production build)…');
    await applyMigrationsProgrammatically(db);
    return;
  }

  const backendRoot = getBackendRoot();
  logger.info('Running prisma migrate deploy…');
  try {
    execSync('npx prisma migrate deploy', {
      cwd: backendRoot,
      stdio: 'pipe',
      env: process.env,
    });
    logger.info('Database migrations up to date');
  } catch (err) {
    if (db) {
      logger.warn('prisma migrate deploy failed — executing programmatic migrations…', {
        err: err instanceof Error ? err.message : String(err),
      });
      await applyMigrationsProgrammatically(db);
      return;
    }
    logger.warn('prisma migrate deploy failed in dev, falling back to db push');
    execSync('npx prisma db push --accept-data-loss', {
      cwd: backendRoot,
      stdio: 'pipe',
      env: process.env,
    });
    logger.info('Database schema pushed successfully');
  }
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
    if (status.databaseExists) {
      try {
        await createDatabaseBackup();
        logger.info('Pre-migration safety backup completed');
      } catch (backupErr) {
        logger.warn('Pre-migration backup failed — continuing with migrations', {
          err: backupErr instanceof Error ? backupErr.message : String(backupErr),
        });
      }
    }

    await runMigrations(db);
    status.migrationsApplied = true;

    await configureSqlitePragmas(db);

    if (status.databaseExists) {
      const integrity = await verifyDatabaseIntegrity(db);
      status.integrityOk = integrity.ok;
      if (!integrity.ok) {
        logger.warn('Database integrity check failed on startup', { results: integrity.results });
      }
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
