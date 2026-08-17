import fs from 'fs';
import path from 'path';
import { getDatabaseFilePath } from './database-path';
import { walCheckpointTruncate } from './database-maintenance';
import { prisma } from './prisma';
import { logger } from './logger';

type LocalBackupState = {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
};

type LocalBackupConfig = {
  backupPath: string;
};

function getDataDir(): string {
  const dir = path.dirname(getDatabaseFilePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getConfigFilePath(): string {
  return path.join(getDataDir(), 'local-backup-config.json');
}

function getStateFilePath(): string {
  return path.join(getDataDir(), 'local-backup-state.json');
}

function loadConfig(): LocalBackupConfig {
  try {
    const file = getConfigFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LocalBackupConfig>;
      return { backupPath: typeof data.backupPath === 'string' ? data.backupPath.trim() : '' };
    }
  } catch (err) {
    logger.warn('Failed to load local backup config', { err: String(err) });
  }
  return { backupPath: '' };
}

function saveConfig(config: LocalBackupConfig): void {
  fs.writeFileSync(getConfigFilePath(), JSON.stringify(config, null, 2), 'utf8');
}

function loadState(): LocalBackupState {
  try {
    const file = getStateFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LocalBackupState>;
      return {
        lastSuccessAt: data.lastSuccessAt ?? null,
        lastAttemptAt: data.lastAttemptAt ?? null,
        lastError: data.lastError ?? null,
      };
    }
  } catch (err) {
    logger.warn('Failed to load local backup state', { err: String(err) });
  }
  return {
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastError: null,
  };
}

function saveState(state: Partial<LocalBackupState>): LocalBackupState {
  const current = loadState();
  const next: LocalBackupState = { ...current, ...state };
  try {
    fs.writeFileSync(getStateFilePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    logger.error('Failed to save local backup state', { err: String(err) });
  }
  return next;
}

function formatFsError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOSPC') return 'Disk is full';
    if (code === 'EACCES' || code === 'EPERM') return 'Permission denied';
    if (code === 'ENOENT') return 'Path not found';
  }
  return err instanceof Error ? err.message : String(err);
}

export async function ensureWritableBackupDirectory(
  dirPath: string,
  createIfMissing = true,
): Promise<string> {
  const normalized = path.resolve(dirPath.trim());
  if (!normalized) {
    throw new Error('Backup folder path is required');
  }

  if (!fs.existsSync(normalized)) {
    if (!createIfMissing) {
      throw new Error(`Backup folder does not exist: ${normalized}`);
    }
    try {
      fs.mkdirSync(normalized, { recursive: true });
    } catch (err) {
      throw new Error(`Cannot create backup folder: ${formatFsError(err)}`);
    }
  }

  const stats = await fs.promises.stat(normalized);
  if (!stats.isDirectory()) {
    throw new Error(`Backup path is not a folder: ${normalized}`);
  }

  try {
    await fs.promises.access(normalized, fs.constants.W_OK);
  } catch {
    throw new Error(`Backup folder is not writable: ${normalized}`);
  }

  const testFile = path.join(normalized, `.write-test-${Date.now()}`);
  try {
    await fs.promises.writeFile(testFile, '');
    await fs.promises.unlink(testFile);
  } catch (err) {
    throw new Error(`Cannot write to backup folder: ${formatFsError(err)}`);
  }

  return normalized;
}

export function getLocalBackupStatus() {
  const config = loadConfig();
  const state = loadState();
  return {
    path: config.backupPath || null,
    lastSuccessAt: state.lastSuccessAt,
    lastAttemptAt: state.lastAttemptAt,
    lastError: state.lastError,
  };
}

export async function saveLocalBackupPath(backupPath: string): Promise<{ path: string }> {
  const resolved = await ensureWritableBackupDirectory(backupPath, true);
  saveConfig({ backupPath: resolved });
  return { path: resolved };
}

export async function runLocalBackup(pathOverride?: string): Promise<{
  ok: boolean;
  path?: string;
  backedUpAt?: string;
  error?: string;
}> {
  const config = loadConfig();
  const targetDir = (pathOverride ?? config.backupPath).trim();

  saveState({ lastAttemptAt: new Date().toISOString(), lastError: null });

  try {
    if (!targetDir) {
      throw new Error('Choose a backup folder before running a local backup');
    }

    const resolvedDir = await ensureWritableBackupDirectory(targetDir, true);
    if (pathOverride?.trim() || config.backupPath !== resolvedDir) {
      saveConfig({ backupPath: resolvedDir });
    }

    const dbPath = getDatabaseFilePath();
    if (!fs.existsSync(dbPath)) {
      throw new Error('Database file not found');
    }

    try {
      await walCheckpointTruncate(prisma);
    } catch (err) {
      logger.warn('WAL checkpoint failed before local backup, proceeding with raw snapshot', err);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(resolvedDir, `backup-${timestamp}.db`);
    await fs.promises.copyFile(dbPath, dest);

    const successTime = new Date().toISOString();
    saveState({ lastSuccessAt: successTime, lastError: null });
    logger.info('Local database backup created', { path: dest });
    return { ok: true, path: dest, backedUpAt: successTime };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    saveState({ lastError: message });
    logger.error('Local database backup failed', { err: message });
    return { ok: false, error: message };
  }
}
