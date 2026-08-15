import fs from 'fs';
import path from 'path';

/** Backend package root (contains prisma/, dist/). Works in dev, bundled, and Electron asar. */
export function getBackendRoot(): string {
  const candidates = [
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../..'),
    path.resolve(process.cwd(), 'backend'),
    path.resolve(process.cwd()),
  ];

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron') | undefined;
    const appPath = electron?.app?.getAppPath?.();
    if (appPath) {
      candidates.unshift(path.join(appPath, 'backend'), appPath);
    }
  } catch {
    // not in Electron
  }

  for (const candidate of candidates) {
    const prismaDir = path.join(candidate, 'prisma');
    if (fs.existsSync(prismaDir) && fs.statSync(prismaDir).isDirectory()) {
      return candidate;
    }
  }

  return path.resolve(__dirname, '..');
}

/** Resolve the on-disk SQLite file from DATABASE_URL (file:…). Strips query params (e.g. connection_limit). */
export function getDatabaseFilePath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/sheraztrader.db?connection_limit=1';
  const withoutScheme = url.replace(/^file:/, '');
  const raw = withoutScheme.split('?')[0] ?? withoutScheme;
  if (path.isAbsolute(raw)) return raw;
  // Match Prisma: relative SQLite paths resolve from the prisma/ schema directory.
  return path.resolve(getBackendRoot(), 'prisma', raw);
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
