import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../utils/helpers';
import { prisma } from '../../lib/prisma';
import {
  createDatabaseBackup,
  verifyDatabaseIntegrity,
  walCheckpointTruncate,
} from '../../lib/database-maintenance';
import { getBackupDirectory, getDatabaseFilePath } from '../../lib/database-path';
import type { StartupStatus } from '../../lib/startup';

export const systemRouter = Router();

systemRouter.use(requireAuth);
systemRouter.use(requireAdmin);

systemRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json({
      databasePath: getDatabaseFilePath(),
      backupDirectory: getBackupDirectory(),
    });
  }),
);

systemRouter.post(
  '/verify-database',
  asyncHandler(async (_req, res) => {
    const result = await verifyDatabaseIntegrity(prisma);
    res.json(result);
  }),
);

systemRouter.post(
  '/backup-database',
  asyncHandler(async (_req, res) => {
    const path = await createDatabaseBackup();
    res.json({ ok: true, path });
  }),
);

systemRouter.post(
  '/wal-checkpoint',
  asyncHandler(async (_req, res) => {
    await walCheckpointTruncate(prisma);
    res.json({ ok: true });
  }),
);

export function createSystemHealthHandler(getStartupStatus?: () => StartupStatus | null) {
  return (_req: import('express').Request, res: import('express').Response) => {
    const startup = getStartupStatus?.();
    res.json({
      ok: startup?.ok ?? true,
      app: 'grain-market-pos',
      database: startup
        ? {
            exists: startup.databaseExists,
            migrationsApplied: startup.migrationsApplied,
            integrityOk: startup.integrityOk,
            error: startup.error ?? null,
          }
        : undefined,
    });
  };
}
