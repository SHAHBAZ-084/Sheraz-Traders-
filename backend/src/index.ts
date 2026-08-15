import path from 'path';
import dotenv from 'dotenv';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { initializeDatabase, shutdownDatabase } from './lib/startup';
import { runAccountingMaintenance } from './modules/accounting/accounting.service';
import { logger } from './lib/logger';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

let startupStatus: Awaited<ReturnType<typeof initializeDatabase>> | null = null;

async function main() {
  const app = createApp(() => startupStatus);

  const server = app.listen(env.port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => {
      logger.info(`Grain Market POS API listening on http://127.0.0.1:${env.port}`);
      resolve();
    });
    server.once('error', reject);
  });

  startupStatus = await initializeDatabase(prisma);
  if (!startupStatus.ok) {
    logger.error('Startup aborted — database not ready', startupStatus);
    process.exit(1);
  }

  void runAccountingMaintenance().catch((err) => {
    logger.warn('Accounting maintenance on startup failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down…`);
    server.close();
    await shutdownDatabase(prisma);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

export const backendReady = main().catch((err) => {
  logger.error('Fatal startup error', { err: String(err) });
  process.exit(1);
});

export default createApp;
