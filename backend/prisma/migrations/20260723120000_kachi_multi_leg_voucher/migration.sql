-- KACHI multi-leg voucher: nullable accounts, per-type numbering, KACHI enum
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Voucher" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "debitAccountId" INTEGER,
    "creditAccountId" INTEGER,
    "amount" DECIMAL NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER NOT NULL,
    "modifiedById" INTEGER,
    "deletedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "financialYearId" INTEGER,
    CONSTRAINT "Voucher_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Voucher_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Voucher_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Voucher_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Voucher_modifiedById_fkey" FOREIGN KEY ("modifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Voucher_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Voucher" (
    "id", "type", "number", "date", "debitAccountId", "creditAccountId", "amount",
    "description", "reference", "status", "createdById", "modifiedById", "deletedById",
    "createdAt", "updatedAt", "deletedAt", "financialYearId"
)
SELECT
    "id",
    CASE WHEN "type" = 'KACHI_MAAL' THEN 'KACHI' ELSE "type" END,
    "number", "date", "debitAccountId", "creditAccountId", "amount",
    "description", "reference", "status", "createdById", "modifiedById", "deletedById",
    "createdAt", "updatedAt", "deletedAt", "financialYearId"
FROM "Voucher";

DROP TABLE "Voucher";
ALTER TABLE "new_Voucher" RENAME TO "Voucher";

CREATE UNIQUE INDEX "Voucher_financialYearId_type_number_key" ON "Voucher"("financialYearId", "type", "number");
CREATE INDEX "Voucher_financialYearId_type_idx" ON "Voucher"("financialYearId", "type");
CREATE INDEX "Voucher_date_idx" ON "Voucher"("date");
CREATE INDEX "Voucher_createdAt_idx" ON "Voucher"("createdAt");
CREATE INDEX "Voucher_status_idx" ON "Voucher"("status");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
