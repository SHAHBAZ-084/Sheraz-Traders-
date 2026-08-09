import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { asyncHandler, AppError } from '../../utils/helpers';
import { prisma } from '../../lib/prisma';
import {
  createDatabaseBackup,
  verifyDatabaseIntegrity,
  walCheckpointTruncate,
} from '../../lib/database-maintenance';
import { getBackupDirectory, getDatabaseFilePath } from '../../lib/database-path';
import type { StartupStatus } from '../../lib/startup';

import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  getBackupStatus,
  runAutoBackupCycle,
} from '../../lib/google-drive-backup';

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

systemRouter.get(
  '/backup-status',
  asyncHandler(async (_req, res) => {
    const status = getBackupStatus();
    res.json(status);
  }),
);

systemRouter.post(
  '/google-drive/connect',
  asyncHandler(async (_req, res) => {
    const result = await connectGoogleDrive();
    res.json(result);
  }),
);

systemRouter.post(
  '/google-drive/disconnect',
  asyncHandler(async (_req, res) => {
    disconnectGoogleDrive();
    res.json({ ok: true, message: 'Google Drive disconnected' });
  }),
);

systemRouter.post(
  '/google-drive/backup-now',
  asyncHandler(async (_req, res) => {
    const result = await runAutoBackupCycle();
    if (!result.ok) {
      throw new AppError(400, result.error ?? 'Backup failed');
    }
    res.json({ ok: true });
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
