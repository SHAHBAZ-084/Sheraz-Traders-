import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function resolveSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    throw new Error('SESSION_SECRET is required in production (Electron persists one per install)');
  }
  // Dev-only ephemeral secret — never a shared hardcoded string.
  return crypto.randomBytes(32).toString('hex');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3847),
  sessionSecret: resolveSessionSecret(),
  isProduction: (process.env.NODE_ENV ?? 'development') === 'production',
};
