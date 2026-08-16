import { PrismaClient } from '@prisma/client';
import { withSqliteRetry } from './sqlite-retry';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const baseClient = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  // Small SQLite pool (connection_limit=5) + busy_timeout + withSqliteRetry — not a single connection.
  transactionOptions: {
    maxWait: 30_000,
    timeout: 120_000,
  },
});

const extendedClient = baseClient.$extends({
  query: {
    $allModels: {
      $allOperations({ args, query }) {
        return withSqliteRetry(() => query(args));
      },
    },
  },
  client: {
    $transaction(firstArg: unknown, secondArg?: unknown) {
      return withSqliteRetry(() => {
        if (typeof firstArg === 'function') {
          return baseClient.$transaction(firstArg as Parameters<PrismaClient['$transaction']>[0], secondArg as Parameters<PrismaClient['$transaction']>[1]);
        }
        return baseClient.$transaction(firstArg as Parameters<PrismaClient['$transaction']>[0], secondArg as Parameters<PrismaClient['$transaction']>[1]);
      });
    },
    $queryRaw(...args: unknown[]) {
      return withSqliteRetry(() => (baseClient.$queryRaw as (...a: unknown[]) => ReturnType<PrismaClient['$queryRaw']>)(...args));
    },
    $queryRawUnsafe(...args: unknown[]) {
      return withSqliteRetry(() =>
        (baseClient.$queryRawUnsafe as (...a: unknown[]) => ReturnType<PrismaClient['$queryRawUnsafe']>)(...args),
      );
    },
    $executeRaw(...args: unknown[]) {
      return withSqliteRetry(() => (baseClient.$executeRaw as (...a: unknown[]) => ReturnType<PrismaClient['$executeRaw']>)(...args));
    },
    $executeRawUnsafe(...args: unknown[]) {
      return withSqliteRetry(() =>
        (baseClient.$executeRawUnsafe as (...a: unknown[]) => ReturnType<PrismaClient['$executeRawUnsafe']>)(...args),
      );
    },
    $connect(...args: unknown[]) {
      return withSqliteRetry(() => (baseClient.$connect as (...a: unknown[]) => ReturnType<PrismaClient['$connect']>)(...args));
    },
    $disconnect(...args: unknown[]) {
      return withSqliteRetry(() => (baseClient.$disconnect as (...a: unknown[]) => ReturnType<PrismaClient['$disconnect']>)(...args));
    },
  },
});

export const prisma = (globalForPrisma.prisma ?? extendedClient) as unknown as PrismaClient;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
