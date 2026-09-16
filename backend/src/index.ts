import path from 'path';
import dotenv from 'dotenv';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { initializeDatabase, shutdownDatabase } from './lib/startup';
import { runAccountingMaintenance } from './modules/accounting/accounting.service';
import { backfillNullProductAverageCosts } from './modules/products/backfill-product-average-cost';
import { backfillProductLedgerDescriptions } from './modules/invoices/backfill-product-ledger-descriptions';
import { logger } from './lib/logger';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    err: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', {
    err: err.message,
    stack: err.stack,
  });
  if (env.isProduction) {
    void prisma.$disconnect().finally(() => process.exit(1));
  }
});

let startupStatus: Awaited<ReturnType<typeof initializeDatabase>> | null = null;

async function main() {
  const app = createApp(() => startupStatus);

  const server = app.listen(env.port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => {
      logger.info(`Sheeraz Traders API listening on http://127.0.0.1:${env.port}`);
      resolve();
    });
    server.once('error', reject);
  });

  startupStatus = await initializeDatabase(prisma);
  if (!startupStatus.ok) {
    logger.error('Startup aborted — database not ready', startupStatus);
    process.exit(1);
  }

  // Repair null/zero Product.averageCost before reports are used (fixes pesticide P&L).
  try {
    await backfillNullProductAverageCosts(prisma);
  } catch (err) {
    logger.warn('Product averageCost backfill on startup failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // One-time repair of legacy combined product descriptions on Maal Khata ledger notes.
  // Runs inside production .exe (Electron loads backend/dist/index.js). Marker next to DB
  // ensures it only executes once; only LedgerEntry.notes are updated (no balances/amounts).
  try {
    await backfillProductLedgerDescriptions(prisma);
  } catch (err) {
    logger.warn('Product ledger description backfill on startup failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Defer other maintenance so first user actions are not competing for the SQLite connection.
  setImmediate(() => {
    void (async () => {
      try {
        await runAccountingMaintenance();
      } catch (err) {
        logger.warn('Accounting maintenance on startup failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })();
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
