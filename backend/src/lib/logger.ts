import fs from 'fs';
import path from 'path';
import { getLogDirectory } from './database-path';

type LogLevel = 'info' | 'warn' | 'error';

function todayLogFile(): string {
  const dir = getLogDirectory();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const date = new Date().toISOString().slice(0, 10);
  return path.join(dir, `sheraztrader-${date}.log`);
}

function write(level: LogLevel, message: string, meta?: unknown): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta !== undefined ? { meta } : {}),
  });

  const formatted = `${line}\n`;
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](message, meta ?? '');

  try {
    fs.appendFileSync(todayLogFile(), formatted, 'utf8');
  } catch {
    // Logging must never crash the app.
  }
}

export const logger = {
  info(message: string, meta?: unknown) {
    write('info', message, meta);
  },
  warn(message: string, meta?: unknown) {
    write('warn', message, meta);
  },
  error(message: string, meta?: unknown) {
    write('error', message, meta);
  },
};
