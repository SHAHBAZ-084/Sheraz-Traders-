/*
  Warnings:

  - You are about to alter the column `kachiOpening` on the `PendingAdjustment` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `pendingKachiOpening` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "categoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "excludeFromSelectors" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "pendingOpeningBalance" DECIMAL,
    "pendingOpeningSide" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AccountCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Account_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("categoryId", "code", "createdAt", "createdById", "excludeFromSelectors", "id", "isActive", "name", "pendingOpeningBalance", "pendingOpeningSide", "status", "type") SELECT "categoryId", "code", "createdAt", "createdById", "excludeFromSelectors", "id", "isActive", "name", "pendingOpeningBalance", "pendingOpeningSide", "status", "type" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");
CREATE INDEX "Account_categoryId_idx" ON "Account"("categoryId");
CREATE INDEX "Account_isActive_categoryId_idx" ON "Account"("isActive", "categoryId");
CREATE INDEX "Account_status_idx" ON "Account"("status");
CREATE TABLE "new_FinancialYear" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "label" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "closedAt" DATETIME,
    "closedById" INTEGER,
    "changedAt" DATETIME,
    "changedById" INTEGER,
    CONSTRAINT "FinancialYear_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FinancialYear_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FinancialYear" ("changedAt", "changedById", "closedAt", "closedById", "endDate", "id", "label", "startDate", "status") SELECT "changedAt", "changedById", "closedAt", "closedById", "endDate", "id", "label", "startDate", "status" FROM "FinancialYear";
DROP TABLE "FinancialYear";
ALTER TABLE "new_FinancialYear" RENAME TO "FinancialYear";
CREATE UNIQUE INDEX "FinancialYear_label_key" ON "FinancialYear"("label");
CREATE INDEX "FinancialYear_status_idx" ON "FinancialYear"("status");
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
    "financialYearId" INTEGER,
    CONSTRAINT "LedgerEntry_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LedgerEntry_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LedgerEntry_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LedgerEntry" ("amount", "balance", "createdAt", "financialYearId", "id", "isOpeningBalance", "isReversal", "ledgerId", "mazduriAmount", "notes", "type", "voucherId") SELECT "amount", "balance", "createdAt", "financialYearId", "id", "isOpeningBalance", "isReversal", "ledgerId", "mazduriAmount", "notes", "type", "voucherId" FROM "LedgerEntry";
DROP TABLE "LedgerEntry";
ALTER TABLE "new_LedgerEntry" RENAME TO "LedgerEntry";
CREATE INDEX "LedgerEntry_ledgerId_idx" ON "LedgerEntry"("ledgerId");
CREATE INDEX "LedgerEntry_voucherId_idx" ON "LedgerEntry"("voucherId");
CREATE INDEX "LedgerEntry_createdAt_idx" ON "LedgerEntry"("createdAt");
CREATE INDEX "LedgerEntry_ledgerId_createdAt_idx" ON "LedgerEntry"("ledgerId", "createdAt");
CREATE INDEX "LedgerEntry_ledgerId_id_idx" ON "LedgerEntry"("ledgerId", "id");
CREATE INDEX "LedgerEntry_financialYearId_idx" ON "LedgerEntry"("financialYearId");
CREATE TABLE "new_PendingAdjustment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "adjustmentDate" DATETIME NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" INTEGER,
    "amount" DECIMAL,
    "side" TEXT,
    "productId" INTEGER,
    "storeId" INTEGER,
    "quantity" DECIMAL,
    "rate" DECIMAL,
    "kachiOpening" JSONB,
    CONSTRAINT "PendingAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PendingAdjustment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PendingAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PendingAdjustment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PendingAdjustment" ("accountId", "adjustmentDate", "amount", "createdAt", "createdById", "id", "kachiOpening", "kind", "productId", "quantity", "rate", "side", "status", "storeId") SELECT "accountId", "adjustmentDate", "amount", "createdAt", "createdById", "id", "kachiOpening", "kind", "productId", "quantity", "rate", "side", "status", "storeId" FROM "PendingAdjustment";
DROP TABLE "PendingAdjustment";
ALTER TABLE "new_PendingAdjustment" RENAME TO "PendingAdjustment";
CREATE INDEX "PendingAdjustment_status_idx" ON "PendingAdjustment"("status");
CREATE INDEX "PendingAdjustment_kind_status_idx" ON "PendingAdjustment"("kind", "status");
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unit" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'STANDARD',
    "accountId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "pendingOpeningStoreId" INTEGER,
    "pendingOpeningQty" DECIMAL,
    "pendingOpeningRate" DECIMAL,
    "pendingKachiOpening" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("accountId", "categoryId", "code", "createdAt", "createdById", "id", "isActive", "kind", "name", "pendingKachiOpening", "pendingOpeningQty", "pendingOpeningRate", "pendingOpeningStoreId", "status", "unit", "updatedAt") SELECT "accountId", "categoryId", "code", "createdAt", "createdById", "id", "isActive", "kind", "name", "pendingKachiOpening", "pendingOpeningQty", "pendingOpeningRate", "pendingOpeningStoreId", "status", "unit", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");
CREATE UNIQUE INDEX "Product_accountId_key" ON "Product"("accountId");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "Product_isActive_name_idx" ON "Product"("isActive", "name");
CREATE INDEX "Product_status_idx" ON "Product"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
