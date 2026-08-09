-- Financial year admin: silent audit fields, closing snapshot timestamps, ledger entry FY scope.

-- AlterTable
ALTER TABLE "FinancialYear" ADD COLUMN "changedAt" DATETIME;
ALTER TABLE "FinancialYear" ADD COLUMN "changedById" INTEGER;

-- AlterTable
ALTER TABLE "FinancialYearClosingBalance" ADD COLUMN "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN "financialYearId" INTEGER;

-- Backfill ledger entry FY from linked voucher
UPDATE "LedgerEntry"
SET "financialYearId" = (
  SELECT "financialYearId" FROM "Voucher" WHERE "Voucher"."id" = "LedgerEntry"."voucherId"
)
WHERE "voucherId" IS NOT NULL;

-- Backfill opening-balance entries to active FY at time of entry (best-effort by createdAt)
UPDATE "LedgerEntry"
SET "financialYearId" = (
  SELECT fy."id"
  FROM "FinancialYear" fy
  WHERE "LedgerEntry"."createdAt" >= fy."startDate"
    AND (fy."endDate" IS NULL OR "LedgerEntry"."createdAt" <= fy."endDate")
  ORDER BY fy."startDate" DESC
  LIMIT 1
)
WHERE "financialYearId" IS NULL AND "isOpeningBalance" = 1;

-- Remaining orphan entries → active FY
UPDATE "LedgerEntry"
SET "financialYearId" = (SELECT "id" FROM "FinancialYear" WHERE "status" = 'ACTIVE' LIMIT 1)
WHERE "financialYearId" IS NULL;

-- CreateIndex
CREATE INDEX "LedgerEntry_financialYearId_idx" ON "LedgerEntry"("financialYearId");
