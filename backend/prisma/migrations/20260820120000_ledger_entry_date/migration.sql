-- Add LedgerEntry.date as the single source of truth for chronological
-- ordering and date-range filtering (vouchers, invoices, adjustments).
--
-- Step 1: add nullable column so existing rows can be backfilled safely.
ALTER TABLE "LedgerEntry" ADD COLUMN "date" DATETIME;

-- Step 2a: voucher-linked entries → Voucher.date (already correct today).
UPDATE "LedgerEntry"
SET "date" = (
  SELECT "Voucher"."date"
  FROM "Voucher"
  WHERE "Voucher"."id" = "LedgerEntry"."voucherId"
)
WHERE "voucherId" IS NOT NULL;

-- Step 2b: everything else (opening balances, account/stock adjustments that
-- previously relied on createdAt — including stock adjustments that already
-- stamped createdAt with the entered date) → createdAt.
UPDATE "LedgerEntry"
SET "date" = "createdAt"
WHERE "date" IS NULL;

-- Step 3: enforce NOT NULL via SQLite table rebuild (Prisma convention).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LedgerEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ledgerId" INTEGER NOT NULL,
    "voucherId" INTEGER,
    "type" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "balance" DECIMAL NOT NULL,
    "notes" TEXT,
    "mazduriAmount" DECIMAL,
    "isReversal" BOOLEAN NOT NULL DEFAULT false,
    "isOpeningBalance" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "financialYearId" INTEGER,
    CONSTRAINT "LedgerEntry_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LedgerEntry_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LedgerEntry_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LedgerEntry" (
  "id", "ledgerId", "voucherId", "type", "amount", "balance", "notes",
  "mazduriAmount", "isReversal", "isOpeningBalance", "createdAt", "date", "financialYearId"
)
SELECT
  "id", "ledgerId", "voucherId", "type", "amount", "balance", "notes",
  "mazduriAmount", "isReversal", "isOpeningBalance", "createdAt",
  COALESCE("date", "createdAt"), "financialYearId"
FROM "LedgerEntry";
DROP TABLE "LedgerEntry";
ALTER TABLE "new_LedgerEntry" RENAME TO "LedgerEntry";
CREATE INDEX "LedgerEntry_ledgerId_idx" ON "LedgerEntry"("ledgerId");
CREATE INDEX "LedgerEntry_voucherId_idx" ON "LedgerEntry"("voucherId");
CREATE INDEX "LedgerEntry_createdAt_idx" ON "LedgerEntry"("createdAt");
CREATE INDEX "LedgerEntry_date_idx" ON "LedgerEntry"("date");
CREATE INDEX "LedgerEntry_ledgerId_createdAt_idx" ON "LedgerEntry"("ledgerId", "createdAt");
CREATE INDEX "LedgerEntry_ledgerId_date_idx" ON "LedgerEntry"("ledgerId", "date");
CREATE INDEX "LedgerEntry_ledgerId_id_idx" ON "LedgerEntry"("ledgerId", "id");
CREATE INDEX "LedgerEntry_financialYearId_idx" ON "LedgerEntry"("financialYearId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
