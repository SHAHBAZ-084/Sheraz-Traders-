import fs from 'fs';
import path from 'path';
import http from 'http';
import dns from 'dns';
import crypto from 'crypto';
import { google } from 'googleapis';
import { exec } from 'child_process';
import { getBackupDirectory, getDatabaseFilePath } from './database-path';
import { walCheckpointTruncate } from './database-maintenance';
import { prisma } from './prisma';
import { logger } from './logger';

const BACKUP_FOLDER_NAME = 'Sheraz Traders Backups';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes check loop
const TARGET_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours target
const OVERDUE_GRACE_MS = 26 * 60 * 60 * 1000; // 26 hours overdue threshold

type BackupState = {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  needsReconnect: boolean;
  connected?: boolean;
};

function getStateFilePath(): string {
  const dir = path.dirname(getDatabaseFilePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'google-drive-backup-state.json');
}

function getTokenFilePath(): string {
  const dir = path.dirname(getDatabaseFilePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'google-drive-tokens.dat');
}

function loadState(): BackupState {
  try {
    const file = getStateFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        lastSuccessAt: data.lastSuccessAt ?? null,
        lastAttemptAt: data.lastAttemptAt ?? null,
        lastError: data.lastError ?? null,
        needsReconnect: Boolean(data.needsReconnect),
      };
    }
  } catch (err) {
    logger.warn('Failed to load Google Drive backup state', { err: String(err) });
  }
  return {
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastError: null,
    needsReconnect: false,
  };
}

function saveState(state: Partial<BackupState>): BackupState {
  const current = loadState();
  const next: BackupState = { ...current, ...state };
  try {
    fs.writeFileSync(getStateFilePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    logger.error('Failed to save Google Drive backup state', { err: String(err) });
  }
  return next;
}

/** Encrypted Token Persistence (safeStorage in Electron main, AES-256-GCM fallback in Node) */
function getEncryptionKey(): Buffer {
  const secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || 'sheraz-traders-fallback-key-2026';
  return crypto.createHash('sha256').update(secret).digest();
}

function saveRefreshToken(token: string): void {
  try {
    // Attempt Electron safeStorage if available
    let electronSafeStorage: typeof import('electron')['safeStorage'] | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron');
      electronSafeStorage = electron?.safeStorage;
    } catch {
      // not in electron
    }

    if (electronSafeStorage && electronSafeStorage.isEncryptionAvailable()) {
      const encrypted = electronSafeStorage.encryptString(token);
      fs.writeFileSync(getTokenFilePath(), Buffer.concat([Buffer.from('SAFE:'), encrypted]));
      return;
    }

    // Fallback AES-256-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([Buffer.from('FALL:'), iv, tag, encrypted]);
    fs.writeFileSync(getTokenFilePath(), payload);
  } catch (err) {
    logger.error('Failed to save encrypted refresh token', { err: String(err) });
  }
}

function getRefreshToken(): string | null {
  try {
    const file = getTokenFilePath();
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    const prefix = buf.subarray(0, 5).toString('utf8');

    if (prefix === 'SAFE:') {
      let electronSafeStorage: typeof import('electron')['safeStorage'] | undefined;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const electron = require('electron');
        electronSafeStorage = electron?.safeStorage;
      } catch {
        // not in electron
      }
      if (electronSafeStorage && electronSafeStorage.isEncryptionAvailable()) {
        return electronSafeStorage.decryptString(buf.subarray(5));
      }
    } else if (prefix === 'FALL:') {
      const iv = buf.subarray(5, 17);
      const tag = buf.subarray(17, 33);
      const encrypted = buf.subarray(33);
      const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
      decipher.setAuthTag(tag);
      return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
    }
  } catch (err) {
    logger.warn('Failed to decrypt stored refresh token', { err: String(err) });
  }
  return null;
}

export function clearRefreshToken(): void {
  try {
    const file = getTokenFilePath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    logger.error('Failed to remove refresh token file', { err: String(err) });
  }
}

function getOAuth2Client(redirectUri?: string) {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET environment variables must be set');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function isGoogleDriveConnected(): boolean {
  return Boolean(getRefreshToken());
}

export function isInvalidGrantError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const errorObj = err as { message?: string; code?: string; response?: { data?: { error?: string } } };
  if (errorObj.response?.data?.error === 'invalid_grant') return true;
  if (typeof errorObj.message === 'string' && errorObj.message.includes('invalid_grant')) return true;
  return false;
}

/** Perform loopback consent flow */
export async function connectGoogleDrive(): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to obtain loopback address for OAuth authentication'));
        return;
      }
      const port = address.port;
      const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      const oauth2Client = getOAuth2Client(redirectUri);

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/drive.file'],
      });

      server.on('request', async (req, res) => {
        try {
          const reqUrl = new URL(req.url ?? '', `http://127.0.0.1:${port}`);
          if (reqUrl.pathname === '/oauth2callback') {
            const code = reqUrl.searchParams.get('code');
            if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <div style="font-family: system-ui, sans-serif; text-align: center; padding: 40px;">
                  <h2 style="color: #10b981;">Google Drive Connected Successfully!</h2>
                  <p style="color: #4b5563;">You can now close this browser window and return to Sheraz Traders.</p>
                </div>
              `);
              server.close();

              const { tokens } = await oauth2Client.getToken(code);
              if (tokens.refresh_token) {
                saveRefreshToken(tokens.refresh_token);
                saveState({ connected: true, needsReconnect: false, lastError: null });
                resolve({ success: true, message: 'Google Drive connected successfully' });
              } else {
                reject(new Error('No refresh token received from Google OAuth'));
              }
            } else {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Authentication code missing');
            }
          }
        } catch (err) {
          server.close();
          reject(err);
        }
      });

      // Open URL in external browser
      try {
        let opened = false;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const electron = require('electron');
          if (electron?.shell?.openExternal) {
            await electron.shell.openExternal(authUrl);
            opened = true;
          }
        } catch {
          // not in electron
        }
        if (!opened) {
          const startCmd = process.platform === 'win32'
            ? `start "" "${authUrl}"`
            : process.platform === 'darwin'
              ? `open "${authUrl}"`
              : `xdg-open "${authUrl}"`;
          exec(startCmd);
        }
      } catch (err) {
        logger.warn('Could not auto-open browser for Google Drive OAuth, manual URL printed', { authUrl, err: String(err) });
      }
    });
  });
}

export function disconnectGoogleDrive(): void {
  clearRefreshToken();
  saveState({ needsReconnect: false, lastError: null });
}

export async function checkInternetConnection(): Promise<boolean> {
  try {
    await dns.promises.resolve('drive.googleapis.com');
    return true;
  } catch {
    try {
      await dns.promises.resolve('google.com');
      return true;
    } catch {
      return false;
    }
  }
}

async function getAuthenticatedDriveClient() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('Google Drive is not connected');

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  oauth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      saveRefreshToken(tokens.refresh_token);
    }
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function getOrCreateBackupFolder(drive: ReturnType<typeof google.drive>): Promise<string> {
  const response = await drive.files.list({
    q: `name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id!;
  }

  const createResponse = await drive.files.create({
    requestBody: {
      name: BACKUP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  return createResponse.data.id!;
}

export async function runAutoBackupCycle(): Promise<boolean> {
  const state = loadState();
  if (!isGoogleDriveConnected()) {
    return false;
  }
  if (state.needsReconnect) {
    logger.info('Auto-backup skipped — Google Drive needs reconnect (invalid_grant)');
    return false;
  }

  const isOnline = await checkInternetConnection();
  if (!isOnline) {
    logger.info('Auto-backup delayed — no internet connection available');
    return false;
  }

  const backupDir = getBackupDirectory();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const stagingPath = path.join(backupDir, 'database-backup-staging.db');

  saveState({ lastAttemptAt: new Date().toISOString() });

  try {
    const dbPath = getDatabaseFilePath();
    if (!fs.existsSync(dbPath)) {
      logger.info('Auto-backup skipped — database file does not exist yet');
      return false;
    }

    try {
      await walCheckpointTruncate(prisma);
    } catch (err) {
      logger.warn('WAL checkpoint failed before Google Drive upload, proceeding with raw snapshot', err);
    }

    await fs.promises.copyFile(dbPath, stagingPath);

    const drive = await getAuthenticatedDriveClient();
    const folderId = await getOrCreateBackupFolder(drive);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `sheraz-traders-backup-${timestamp}.db`;

    await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType: 'application/x-sqlite3',
        body: fs.createReadStream(stagingPath),
      },
    });

    if (fs.existsSync(stagingPath)) {
      await fs.promises.unlink(stagingPath);
    }

    const successTime = new Date().toISOString();
    saveState({
      lastSuccessAt: successTime,
      lastError: null,
      needsReconnect: false,
    });
    logger.info('Database backed up to Google Drive successfully', { fileName, folder: BACKUP_FOLDER_NAME });
    return true;
  } catch (err) {
    const isRevoked = isInvalidGrantError(err);
    if (isRevoked) {
      saveState({ needsReconnect: true, lastError: 'Google Drive access token expired or revoked. Please reconnect.' });
      logger.error('Google Drive refresh token invalid_grant — setting needsReconnect', { err: String(err) });
    } else {
      saveState({ lastError: String(err) });
      logger.error('Google Drive backup upload failed', { err: String(err) });
    }
    return false;
  }
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startAutoBackupScheduler(): void {
  if (schedulerTimer) return;

  const checkAndRun = async () => {
    const state = loadState();
    if (!isGoogleDriveConnected() || state.needsReconnect) return;

    const lastSuccess = state.lastSuccessAt ? Date.parse(state.lastSuccessAt) : 0;
    const elapsed = Date.now() - lastSuccess;

    if (elapsed >= TARGET_INTERVAL_MS) {
      await runAutoBackupCycle();
    }
  };

  // Immediate check on startup
  checkAndRun().catch((err) => logger.error('Startup auto-backup check failed', { err: String(err) }));

  schedulerTimer = setInterval(() => {
    checkAndRun().catch((err) => logger.error('Scheduled auto-backup check failed', { err: String(err) }));
  }, CHECK_INTERVAL_MS);

  logger.info('Google Drive auto-backup scheduler initialized (target: 24h, check interval: 5m)');
}

export function getBackupStatus() {
  const connected = isGoogleDriveConnected();
  const state = loadState();

  const lastSuccessMs = state.lastSuccessAt ? Date.parse(state.lastSuccessAt) : 0;
  const overdue = connected && !state.needsReconnect && (lastSuccessMs === 0 || Date.now() - lastSuccessMs > OVERDUE_GRACE_MS);

  return {
    connected,
    needsReconnect: state.needsReconnect,
    lastSuccessAt: state.lastSuccessAt,
    lastAttemptAt: state.lastAttemptAt,
    lastError: state.lastError,
    overdue,
  };
}
