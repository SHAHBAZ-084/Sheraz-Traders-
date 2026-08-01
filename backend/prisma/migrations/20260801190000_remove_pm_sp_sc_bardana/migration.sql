-- Destructive: remove Purchase Maal, Sale Paunch, Sale Commission, Empty Bardana.
-- All-or-nothing SQLite transaction.

PRAGMA foreign_keys=OFF;
BEGIN;

-- 1) Ledger entries for removed voucher types
DELETE FROM "LedgerEntry"
WHERE "voucherId" IN (
  SELECT "id" FROM "Voucher"
  WHERE "type" IN ('PURCHASE_MAAL', 'SALE_PAUNCH', 'SALE_COMMISSION')
);

-- 2) Stock movements for removed invoice types
DELETE FROM "StockMovement"
WHERE "invoiceType" IN ('PURCHASE_MAAL', 'SALE_PAUNCH', 'SALE_COMMISSION')
   OR "invoiceId" IN (
     SELECT "id" FROM "Invoice"
     WHERE "type" IN ('PURCHASE_MAAL', 'SALE_PAUNCH', 'SALE_COMMISSION')
   );

-- 3) Empty bardana (entire feature)
DELETE FROM "EmptyBardanaMovement";
DELETE FROM "EmptyBardanaBalance";

-- 4) Line children
DELETE FROM "PurchaseMaalLine";
DELETE FROM "SalePaunchLine";
DELETE FROM "SaleCommissionLine";

-- 5) Invoice items for removed invoices
DELETE FROM "InvoiceItem"
WHERE "invoiceId" IN (
  SELECT "id" FROM "Invoice"
  WHERE "type" IN ('PURCHASE_MAAL', 'SALE_PAUNCH', 'SALE_COMMISSION')
);

-- 6) Invoice–voucher links
DELETE FROM "InvoiceVoucher"
WHERE "invoiceId" IN (
  SELECT "id" FROM "Invoice"
  WHERE "type" IN ('PURCHASE_MAAL', 'SALE_PAUNCH', 'SALE_COMMISSION')
)
OR "voucherId" IN (
  SELECT "id" FROM "Voucher"
  WHERE "type" IN ('PURCHASE_MAAL', 'SALE_PAUNCH', 'SALE_COMMISSION')
);

-- 7) Invoices + vouchers
DELETE FROM "Invoice"
WHERE "type" IN ('PURCHASE_MAAL', 'SALE_PAUNCH', 'SALE_COMMISSION');

DELETE FROM "Voucher"
WHERE "type" IN ('PURCHASE_MAAL', 'SALE_PAUNCH', 'SALE_COMMISSION');

-- 8) Drop empty bardana + line tables
DROP TABLE IF EXISTS "EmptyBardanaMovement";
DROP TABLE IF EXISTS "EmptyBardanaBalance";
DROP TABLE IF EXISTS "PurchaseMaalLine";
DROP TABLE IF EXISTS "SalePaunchLine";
DROP TABLE IF EXISTS "SaleCommissionLine";

-- 9) Rebuild Invoice without PM/SP/SC-only columns
CREATE TABLE "Invoice_new" (
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
    "lowerBardanaMode" TEXT,
    "lowerBardanaQty" DECIMAL,
    "lowerBardanaRate" DECIMAL,
    "lowerBardanaAmount" DECIMAL,
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

INSERT INTO "Invoice_new" (
  "id", "type", "status", "reference", "customerId", "supplierId", "total", "notes",
  "invoiceDate", "billNo", "gariNo", "jins", "qism", "tafseel", "debitAccountId",
  "miscAmount", "lowerBardanaMode", "lowerBardanaQty", "lowerBardanaRate", "lowerBardanaAmount",
  "productId", "storeId", "toStoreId", "legacyInventoryPosting", "financialYearId",
  "createdById", "createdAt", "updatedAt"
)
SELECT
  "id", "type", "status", "reference", "customerId", "supplierId", "total", "notes",
  "invoiceDate", "billNo", "gariNo", "jins", "qism", "tafseel", "debitAccountId",
  "miscAmount", "lowerBardanaMode", "lowerBardanaQty", "lowerBardanaRate", "lowerBardanaAmount",
  "productId", "storeId", "toStoreId", "legacyInventoryPosting", "financialYearId",
  "createdById", "createdAt", "updatedAt"
FROM "Invoice";

DROP TABLE "Invoice";
ALTER TABLE "Invoice_new" RENAME TO "Invoice";

CREATE UNIQUE INDEX "Invoice_reference_key" ON "Invoice"("reference");
CREATE INDEX "Invoice_financialYearId_idx" ON "Invoice"("financialYearId");
CREATE INDEX "Invoice_financialYearId_type_status_idx" ON "Invoice"("financialYearId", "type", "status");
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_storeId_idx" ON "Invoice"("storeId");

-- 10) Rebuild SystemPreference without orphaned PM/SC rate fields
CREATE TABLE "SystemPreference_new" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "daamiPercent" DECIMAL NOT NULL DEFAULT 0,
    "paleDariPercent" DECIMAL NOT NULL DEFAULT 0,
    "brokeryPercent" DECIMAL NOT NULL DEFAULT 0,
    "marketFeeRate" DECIMAL NOT NULL DEFAULT 0,
    "bardanaRate" DECIMAL NOT NULL DEFAULT 0,
    "taxPercent" DECIMAL NOT NULL DEFAULT 0,
    "markeetFeeRate" DECIMAL NOT NULL DEFAULT 0,
    "kantaRate" DECIMAL NOT NULL DEFAULT 0,
    "closingDate" TEXT,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "SystemPreference_new" (
  "id", "daamiPercent", "paleDariPercent", "brokeryPercent", "marketFeeRate",
  "bardanaRate", "taxPercent", "markeetFeeRate", "kantaRate", "closingDate", "updatedAt"
)
SELECT
  "id", "daamiPercent", "paleDariPercent", "brokeryPercent", "marketFeeRate",
  "bardanaRate", "taxPercent", "markeetFeeRate", "kantaRate", "closingDate", "updatedAt"
FROM "SystemPreference";

DROP TABLE "SystemPreference";
ALTER TABLE "SystemPreference_new" RENAME TO "SystemPreference";

-- 11) Approximate ledger.balance from remaining entries (signed sum).
-- Running per-entry balances are refreshed on next ledger access / voucher ops.
UPDATE "Ledger"
SET "balance" = COALESCE((
  SELECT SUM(
    CASE WHEN "type" = 'DEBIT' THEN "amount" ELSE -"amount" END
  )
  FROM "LedgerEntry"
  WHERE "LedgerEntry"."ledgerId" = "Ledger"."id"
), 0);

COMMIT;
PRAGMA foreign_keys=ON;
