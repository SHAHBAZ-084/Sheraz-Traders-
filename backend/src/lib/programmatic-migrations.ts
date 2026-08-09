import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { FinancialYearStatus, PrismaClient, Role } from '@prisma/client';
import { logger } from './logger';
import { bootstrapChartOfAccounts, fiscalYearLabelForDate } from '../modules/accounting/accounting.service';

function findMigrationsDirectory(): string | null {
  const candidates = [
    path.join(__dirname, '../prisma/migrations'),
    path.join(__dirname, '../../prisma/migrations'),
    path.resolve(process.cwd(), 'backend/prisma/migrations'),
    path.resolve(process.cwd(), 'prisma/migrations'),
  ];

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron') | undefined;
    const appPath = electron?.app?.getAppPath?.();
    if (appPath) {
      candidates.unshift(
        path.join(appPath, 'backend/prisma/migrations'),
        path.join(appPath, 'prisma/migrations'),
      );
    }
  } catch {
    // not in Electron
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

function splitSqlStatements(sql: string): string[] {
  // Remove multi-line comments and single line SQL comments
  const cleanSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return cleanSql
    .split(';')
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

export async function applyMigrationsProgrammatically(db: PrismaClient): Promise<void> {
  const migrationsDir = findMigrationsDirectory();
  if (!migrationsDir) {
    logger.warn('Migrations directory not found, skipping programmatic migrations');
    return;
  }

  // Ensure _prisma_migrations table exists
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    );
  `);

  const appliedRows = (await db.$queryRawUnsafe(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
  )) as Array<{ migration_name: string }>;
  const appliedSet = new Set(appliedRows.map((r) => r.migration_name));

  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const migrationDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  let newMigrationsCount = 0;

  for (const dirName of migrationDirs) {
    if (appliedSet.has(dirName)) continue;

    const sqlFile = path.join(migrationsDir, dirName, 'migration.sql');
    if (!fs.existsSync(sqlFile)) continue;

    logger.info(`Applying migration programmatically: ${dirName}`);
    const sqlContent = fs.readFileSync(sqlFile, 'utf8');
    const statements = splitSqlStatements(sqlContent);

    for (const stmt of statements) {
      try {
        await db.$executeRawUnsafe(stmt);
      } catch (err) {
        // Ignore "table already exists" / "index already exists" if any
        const msg = String(err);
        if (!msg.includes('already exists')) {
          logger.error(`Error executing statement in ${dirName}: ${stmt}`, { err: msg });
          throw err;
        }
      }
    }

    const migrationId = crypto.randomUUID();
    await db.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count") VALUES (?, ?, CURRENT_TIMESTAMP, ?, 1)`,
      migrationId,
      'programmatic-checksum',
      dirName,
    );

    newMigrationsCount += 1;
  }

  if (newMigrationsCount > 0) {
    logger.info(`Applied ${newMigrationsCount} migration(s) programmatically.`);
  }

  await ensureDefaultSeedData(db);
}

export async function ensureDefaultSeedData(db: PrismaClient): Promise<void> {
  try {
    const userCount = await db.user.count();
    if (userCount === 0) {
      logger.info('No users found. Seeding default admin and user accounts…');
      const adminPasswordHash = await bcrypt.hash('admin123', 10);
      await db.user.create({
        data: {
          username: 'admin',
          passwordHash: adminPasswordHash,
          displayName: 'Shop Owner',
          role: Role.ADMIN,
        },
      });

      const clerkPasswordHash = await bcrypt.hash('user123', 10);
      await db.user.create({
        data: {
          username: 'user',
          passwordHash: clerkPasswordHash,
          displayName: 'Shop Clerk',
          role: Role.USER,
        },
      });
      logger.info('Default accounts "admin" (admin123) and "user" (user123) created.');
    }

    const activeYear = await db.financialYear.findFirst({
      where: { status: FinancialYearStatus.ACTIVE },
    });
    if (!activeYear) {
      const now = new Date();
      const { label, startDate } = fiscalYearLabelForDate(now);
      await db.financialYear.create({
        data: {
          label,
          startDate,
          status: FinancialYearStatus.ACTIVE,
        },
      });
      logger.info(`Created active financial year "${label}".`);
    }

    await bootstrapChartOfAccounts();
  } catch (err) {
    logger.error('Error during default data seeding', { err: String(err) });
  }
}
