import fs from 'fs';
import path from 'path';
import http from 'http';
import dns from 'dns';
import crypto from 'crypto';
import { google } from 'googleapis';
import { exec } from 'child_process';
import { getBackupDirectory, getDatabaseFilePath } from './database-path';
import { walCheckpointTruncate } from './database-maintenance';
import {
  getEffectiveGoogleOAuthCredentials,
  getGoogleOAuthConfigStatus,
  isGoogleOAuthConfigured,
} from './google-oauth-credentials';
import { prisma } from './prisma';
import { logger } from './logger';

const BACKUP_FOLDER_NAME = 'Sheeraz Traders Backups';
const LEGACY_BACKUP_FOLDER_NAMES = ['Sheraz Traders Backups'] as const;

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
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET is required for Google Drive token encryption');
  }
  return crypto.createHash('sha256').update(`google-drive-token:${secret}`).digest();
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
  const creds = getEffectiveGoogleOAuthCredentials();
  if (!creds) {
    throw new Error(
      'Google Drive OAuth is not configured. Enter your Google Cloud Client ID and Client Secret in Database Maintenance first.',
    );
  }
  return new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
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

/** Perform loopback consent flow (127.0.0.1 — valid for installed desktop apps, not localhost dev server). */
export async function connectGoogleDrive(): Promise<{ success: boolean; message: string }> {
  if (!isGoogleOAuthConfigured()) {
    throw new Error(
      'Google Drive OAuth is not configured. Enter your Google Cloud Client ID and Client Secret in Database Maintenance first.',
    );
  }

  const isOnline = await checkInternetConnection();
  if (!isOnline) {
    throw new Error('No internet connection. Connect to the internet and try again.');
  }

  return new Promise((resolve, reject) => {
    const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
    let settled = false;

    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      handler();
    };

    const server = http.createServer();
    const timeoutHandle = setTimeout(() => {
      server.close();
      finish(() => reject(new Error('Google sign-in timed out. Please try again.')));
    }, OAUTH_TIMEOUT_MS);

    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        finish(() => reject(new Error('Failed to obtain loopback address for OAuth authentication')));
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
            const error = reqUrl.searchParams.get('error');
            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Authentication was cancelled or denied');
              server.close();
              finish(() => reject(new Error('Google sign-in was cancelled or denied')));
              return;
            }

            const code = reqUrl.searchParams.get('code');
            if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <div style="font-family: system-ui, sans-serif; text-align: center; padding: 40px;">
                  <h2 style="color: #10b981;">Google Drive Connected Successfully!</h2>
                  <p style="color: #4b5563;">You can now close this browser window and return to Sheeraz Traders.</p>
                </div>
              `);
              server.close();

              try {
                const { tokens } = await oauth2Client.getToken(code);
                if (tokens.refresh_token) {
                  saveRefreshToken(tokens.refresh_token);
                  saveState({ connected: true, needsReconnect: false, lastError: null });
                  finish(() => resolve({ success: true, message: 'Google Drive connected successfully' }));
                } else {
                  finish(() => reject(new Error('No refresh token received from Google OAuth')));
                }
              } catch (tokenErr) {
                finish(() => reject(tokenErr instanceof Error ? tokenErr : new Error(String(tokenErr))));
              }
            } else {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Authentication code missing');
              server.close();
              finish(() => reject(new Error('Authentication code missing')));
            }
          }
        } catch (err) {
          server.close();
          finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        }
      });

      server.on('error', (err) => {
        finish(() => reject(err));
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
        server.close();
        finish(() =>
          reject(
            new Error('Could not open your browser for Google sign-in. Check your default browser settings.'),
          ),
        );
      }
    });

    server.on('error', (err) => {
      finish(() => reject(err));
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
  const folderNames = [BACKUP_FOLDER_NAME, ...LEGACY_BACKUP_FOLDER_NAMES];

  for (const folderName of folderNames) {
    const response = await drive.files.list({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });

    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id!;
    }
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

export async function runGoogleDriveBackup(): Promise<{ ok: boolean; uploadedAt?: string; error?: string }> {
  const state = loadState();
  if (!isGoogleDriveConnected()) {
    return { ok: false, error: 'Google Drive is not connected' };
  }
  if (state.needsReconnect) {
    return { ok: false, error: 'Google Drive needs reconnect' };
  }

  const isOnline = await checkInternetConnection();
  if (!isOnline) {
    return { ok: false, error: 'No internet connection — please connect and try again' };
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
      logger.info('Google Drive backup skipped — database file does not exist yet');
      return { ok: false, error: 'Database file not found' };
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
    const fileName = `sheeraz-traders-backup-${timestamp}.db`;

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
    return { ok: true, uploadedAt: successTime };
  } catch (err) {
    const isRevoked = isInvalidGrantError(err);
    const message = isRevoked
      ? 'Google Drive access token expired or revoked. Please reconnect.'
      : err instanceof Error
        ? err.message
        : String(err);
    if (isRevoked) {
      saveState({ needsReconnect: true, lastError: message });
      logger.error('Google Drive refresh token invalid_grant — setting needsReconnect', { err: String(err) });
    } else {
      saveState({ lastError: message });
      logger.error('Google Drive backup upload failed', { err: String(err) });
    }
    return { ok: false, error: message };
  }
}

export function getBackupStatus() {
  const connected = isGoogleDriveConnected();
  const state = loadState();
  const oauth = getGoogleOAuthConfigStatus();

  return {
    connected,
    needsReconnect: state.needsReconnect,
    lastSuccessAt: state.lastSuccessAt,
    lastAttemptAt: state.lastAttemptAt,
    lastError: state.lastError,
    oauthConfigured: oauth.configured,
    oauthClientIdHint: oauth.clientIdHint,
  };
}

export { getGoogleOAuthConfigStatus, isGoogleOAuthConfigured };
