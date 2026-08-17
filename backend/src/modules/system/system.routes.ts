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
  runGoogleDriveBackup,
} from '../../lib/google-drive-backup';
import {
  getLocalBackupStatus,
  runLocalBackup,
  saveLocalBackupPath,
} from '../../lib/local-backup';
import {
  getGoogleOAuthConfigStatus,
  saveGoogleOAuthCredentials,
} from '../../lib/google-oauth-credentials';

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
    res.json({
      ...getBackupStatus(),
      local: getLocalBackupStatus(),
    });
  }),
);

systemRouter.get(
  '/google-drive/oauth-config',
  asyncHandler(async (_req, res) => {
    res.json(getGoogleOAuthConfigStatus());
  }),
);

systemRouter.post(
  '/google-drive/oauth-config',
  asyncHandler(async (req, res) => {
    const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.trim() : '';
    const clientSecret = typeof req.body?.clientSecret === 'string' ? req.body.clientSecret.trim() : '';
    if (!clientId || !clientSecret) {
      throw new AppError(400, 'Google OAuth Client ID and Client Secret are required');
    }
    saveGoogleOAuthCredentials(clientId, clientSecret);
    res.json({ ok: true, ...getGoogleOAuthConfigStatus() });
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
    const result = await runGoogleDriveBackup();
    if (!result.ok) {
      throw new AppError(400, result.error ?? 'Backup failed');
    }
    res.json({ ok: true, uploadedAt: result.uploadedAt ?? new Date().toISOString() });
  }),
);

systemRouter.post(
  '/backup/local/config',
  asyncHandler(async (req, res) => {
    const backupPath = typeof req.body?.path === 'string' ? req.body.path : '';
    if (!backupPath.trim()) {
      throw new AppError(400, 'Backup folder path is required');
    }
    const saved = await saveLocalBackupPath(backupPath);
    res.json({ ok: true, path: saved.path });
  }),
);

systemRouter.post(
  '/backup/local',
  asyncHandler(async (req, res) => {
    const pathOverride = typeof req.body?.path === 'string' ? req.body.path : undefined;
    const result = await runLocalBackup(pathOverride);
    if (!result.ok) {
      throw new AppError(400, result.error ?? 'Local backup failed');
    }
    res.json({ ok: true, path: result.path, backedUpAt: result.backedUpAt ?? new Date().toISOString() });
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
    const ready = startup?.ok === true;
    const body = {
      ok: ready,
      app: 'grain-market-pos',
      database: startup
        ? {
            exists: startup.databaseExists,
            migrationsApplied: startup.migrationsApplied,
            integrityOk: startup.integrityOk,
            error: startup.error ?? null,
          }
        : undefined,
    };

    if (!ready) {
      res.status(503).json(body);
      return;
    }

    res.json(body);
  };
}
