import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDatabaseFilePath } from './database-path';
import { logger } from './logger';

export type GoogleOAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

function getCredentialsFilePath(): string {
  const dir = path.dirname(getDatabaseFilePath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'google-oauth-credentials.dat');
}

function getLocalEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET is required before storing Google OAuth credentials');
  }
  return crypto.createHash('sha256').update(`google-oauth:${secret}`).digest();
}

function getElectronSafeStorage(): typeof import('electron')['safeStorage'] | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    return electron?.safeStorage;
  } catch {
    return undefined;
  }
}

function encryptPayload(json: string): Buffer {
  const safeStorage = getElectronSafeStorage();
  if (safeStorage?.isEncryptionAvailable()) {
    return Buffer.concat([Buffer.from('SAFE:'), safeStorage.encryptString(json)]);
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getLocalEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('FALL:'), iv, tag, encrypted]);
}

function decryptPayload(buf: Buffer): string | null {
  const prefix = buf.subarray(0, 5).toString('utf8');

  if (prefix === 'SAFE:') {
    const safeStorage = getElectronSafeStorage();
    if (safeStorage?.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf.subarray(5));
    }
    return null;
  }

  if (prefix === 'FALL:') {
    const iv = buf.subarray(5, 17);
    const tag = buf.subarray(17, 33);
    const encrypted = buf.subarray(33);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getLocalEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }

  return null;
}

export function loadGoogleOAuthCredentials(): GoogleOAuthCredentials | null {
  try {
    const file = getCredentialsFilePath();
    if (!fs.existsSync(file)) return null;
    const decrypted = decryptPayload(fs.readFileSync(file));
    if (!decrypted) return null;
    const parsed = JSON.parse(decrypted) as GoogleOAuthCredentials;
    if (!parsed.clientId?.trim() || !parsed.clientSecret?.trim()) return null;
    return {
      clientId: parsed.clientId.trim(),
      clientSecret: parsed.clientSecret.trim(),
    };
  } catch (err) {
    logger.warn('Failed to load Google OAuth credentials', { err: String(err) });
    return null;
  }
}

export function saveGoogleOAuthCredentials(clientId: string, clientSecret: string): void {
  const trimmedId = clientId.trim();
  const trimmedSecret = clientSecret.trim();
  if (!trimmedId || !trimmedSecret) {
    throw new Error('Google OAuth Client ID and Client Secret are required');
  }

  const payload = encryptPayload(
    JSON.stringify({ clientId: trimmedId, clientSecret: trimmedSecret } satisfies GoogleOAuthCredentials),
  );
  fs.writeFileSync(getCredentialsFilePath(), payload, { mode: 0o600 });

  process.env.GOOGLE_DRIVE_CLIENT_ID = trimmedId;
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = trimmedSecret;
}

export function clearGoogleOAuthCredentials(): void {
  try {
    const file = getCredentialsFilePath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    logger.error('Failed to remove Google OAuth credentials file', { err: String(err) });
  }
  delete process.env.GOOGLE_DRIVE_CLIENT_ID;
  delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
}

export function getEffectiveGoogleOAuthCredentials(): GoogleOAuthCredentials | null {
  const envId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  const envSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret };
  }
  return loadGoogleOAuthCredentials();
}

export function applyGoogleOAuthCredentialsToEnv(): boolean {
  const creds = loadGoogleOAuthCredentials();
  if (!creds) return false;
  process.env.GOOGLE_DRIVE_CLIENT_ID = creds.clientId;
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = creds.clientSecret;
  return true;
}

export function isGoogleOAuthConfigured(): boolean {
  return getEffectiveGoogleOAuthCredentials() !== null;
}

export function getGoogleOAuthConfigStatus(): { configured: boolean; clientIdHint: string | null } {
  const creds = getEffectiveGoogleOAuthCredentials();
  if (!creds) {
    return { configured: false, clientIdHint: null };
  }
  const { clientId } = creds;
  const hint =
    clientId.length > 16
      ? `${clientId.slice(0, 8)}…${clientId.slice(-12)}`
      : clientId;
  return { configured: true, clientIdHint: hint };
}
