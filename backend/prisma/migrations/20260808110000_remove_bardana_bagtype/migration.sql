-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reference" TEXT NOT NULL,
    "customerId" INTEGER,
    "supplierId" INTEGER,
    "total" DECIMAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "invoiceDate" DATETIME,
    "billNo" TEXT,
    "gariNo" TEXT,
    "jins" TEXT,
    "qism" TEXT,
    "tafseel" TEXT,
    "debitAccountId" INTEGER,
    "miscAmount" DECIMAL NOT NULL DEFAULT 0,
    "productId" INTEGER,
    "storeId" INTEGER,
    "toStoreId" INTEGER,
    "legacyInventoryPosting" BOOLEAN NOT NULL DEFAULT false,
    "financialYearId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_toStoreId_fkey" FOREIGN KEY ("toStoreId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("billNo", "createdAt", "createdById", "customerId", "debitAccountId", "financialYearId", "gariNo", "id", "invoiceDate", "jins", "legacyInventoryPosting", "miscAmount", "notes", "productId", "qism", "reference", "status", "storeId", "supplierId", "tafseel", "toStoreId", "total", "type", "updatedAt") SELECT "billNo", "createdAt", "createdById", "customerId", "debitAccountId", "financialYearId", "gariNo", "id", "invoiceDate", "jins", "legacyInventoryPosting", "miscAmount", "notes", "productId", "qism", "reference", "status", "storeId", "supplierId", "tafseel", "toStoreId", "total", "type", "updatedAt" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_reference_key" ON "Invoice"("reference");
CREATE INDEX "Invoice_financialYearId_idx" ON "Invoice"("financialYearId");
CREATE INDEX "Invoice_financialYearId_type_status_idx" ON "Invoice"("financialYearId", "type", "status");
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_storeId_idx" ON "Invoice"("storeId");
CREATE TABLE "new_KachiMaalLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "partyAccountId" INTEGER NOT NULL,
    "jins" TEXT,
    "qism" TEXT,
    "bagCount" DECIMAL NOT NULL DEFAULT 0,
    "bhartii" DECIMAL NOT NULL DEFAULT 0,
    "dharanCount" DECIMAL NOT NULL DEFAULT 0,
    "looseKg" DECIMAL NOT NULL DEFAULT 0,
    "totalWeightKg" DECIMAL NOT NULL DEFAULT 0,
    "ratePerMaund" DECIMAL NOT NULL DEFAULT 0,
    "amount" DECIMAL NOT NULL DEFAULT 0,
    "netCreditToParty" DECIMAL NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "KachiMaalLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KachiMaalLine_partyAccountId_fkey" FOREIGN KEY ("partyAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_KachiMaalLine" ("amount", "bagCount", "bhartii", "dharanCount", "id", "invoiceId", "jins", "looseKg", "netCreditToParty", "partyAccountId", "qism", "ratePerMaund", "sortOrder", "totalWeightKg") SELECT "amount", "bagCount", "bhartii", "dharanCount", "id", "invoiceId", "jins", "looseKg", "netCreditToParty", "partyAccountId", "qism", "ratePerMaund", "sortOrder", "totalWeightKg" FROM "KachiMaalLine";
DROP TABLE "KachiMaalLine";
ALTER TABLE "new_KachiMaalLine" RENAME TO "KachiMaalLine";
CREATE INDEX "KachiMaalLine_invoiceId_idx" ON "KachiMaalLine"("invoiceId");
CREATE INDEX "KachiMaalLine_partyAccountId_idx" ON "KachiMaalLine"("partyAccountId");
CREATE TABLE "new_StockMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "storeId" INTEGER,
    "direction" TEXT NOT NULL,
    "bags" DECIMAL NOT NULL,
    "date" DATETIME NOT NULL,
    "invoiceId" INTEGER,
    "invoiceType" TEXT NOT NULL,
    "invoiceReference" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockMovement" ("bags", "createdAt", "date", "description", "direction", "id", "invoiceId", "invoiceReference", "invoiceType", "productId", "storeId") SELECT "bags", "createdAt", "date", "description", "direction", "id", "invoiceId", "invoiceReference", "invoiceType", "productId", "storeId" FROM "StockMovement";
DROP TABLE "StockMovement";
ALTER TABLE "new_StockMovement" RENAME TO "StockMovement";
CREATE INDEX "StockMovement_productId_date_id_idx" ON "StockMovement"("productId", "date", "id");
CREATE INDEX "StockMovement_invoiceId_idx" ON "StockMovement"("invoiceId");
CREATE INDEX "StockMovement_storeId_idx" ON "StockMovement"("storeId");
CREATE TABLE "new_StockRemainder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "storeId" INTEGER,
    "remainderKg" DECIMAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockRemainder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockRemainder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockRemainder" ("id", "productId", "remainderKg", "storeId", "updatedAt") SELECT "id", "productId", "remainderKg", "storeId", "updatedAt" FROM "StockRemainder";
DROP TABLE "StockRemainder";
ALTER TABLE "new_StockRemainder" RENAME TO "StockRemainder";
CREATE INDEX "StockRemainder_productId_idx" ON "StockRemainder"("productId");
CREATE INDEX "StockRemainder_storeId_idx" ON "StockRemainder"("storeId");
CREATE UNIQUE INDEX "StockRemainder_productId_storeId_key" ON "StockRemainder"("productId", "storeId");
CREATE TABLE "new_SystemPreference" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "daamiPercent" DECIMAL NOT NULL DEFAULT 0,
    "paleDariPercent" DECIMAL NOT NULL DEFAULT 0,
    "brokeryPercent" DECIMAL NOT NULL DEFAULT 0,
    "marketFeeRate" DECIMAL NOT NULL DEFAULT 0,
    "marketFeeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "taxPercent" DECIMAL NOT NULL DEFAULT 0,
    "markeetFeeRate" DECIMAL NOT NULL DEFAULT 0,
    "kantaRate" DECIMAL NOT NULL DEFAULT 0,
    "closingDate" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SystemPreference" ("brokeryPercent", "closingDate", "daamiPercent", "id", "kantaRate", "markeetFeeRate", "marketFeeRate", "paleDariPercent", "taxPercent", "updatedAt") SELECT "brokeryPercent", "closingDate", "daamiPercent", "id", "kantaRate", "markeetFeeRate", "marketFeeRate", "paleDariPercent", "taxPercent", "updatedAt" FROM "SystemPreference";
DROP TABLE "SystemPreference";
ALTER TABLE "new_SystemPreference" RENAME TO "SystemPreference";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
