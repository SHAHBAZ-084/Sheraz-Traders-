-- Allow invoice references to reset per financial year (SI-00001 in each FY).

-- Backfill missing invoice FY to active year
UPDATE "Invoice"
SET "financialYearId" = (SELECT "id" FROM "FinancialYear" WHERE "status" = 'ACTIVE' LIMIT 1)
WHERE "financialYearId" IS NULL;

-- Redefine Invoice: drop global reference unique, add per-FY unique
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
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_toStoreId_fkey" FOREIGN KEY ("toStoreId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" SELECT * FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_financialYearId_reference_key" ON "Invoice"("financialYearId", "reference");
CREATE INDEX "Invoice_financialYearId_idx" ON "Invoice"("financialYearId");
CREATE INDEX "Invoice_financialYearId_type_status_idx" ON "Invoice"("financialYearId", "type", "status");
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_storeId_idx" ON "Invoice"("storeId");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_supplierId_idx" ON "Invoice"("supplierId");
CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");
CREATE INDEX "Invoice_type_status_idx" ON "Invoice"("type", "status");
