-- Purchase Maal invoice lines and PURCHASE_MAAL voucher type
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "PurchaseMaalLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "partyAccountId" INTEGER NOT NULL,
    "jins" TEXT,
    "qism" TEXT,
    "boriOrThelaMode" TEXT NOT NULL,
    "bagCount" DECIMAL NOT NULL DEFAULT 0,
    "bhartii" DECIMAL NOT NULL DEFAULT 0,
    "dharanCount" DECIMAL NOT NULL DEFAULT 0,
    "looseKg" DECIMAL NOT NULL DEFAULT 0,
    "totalWeightKg" DECIMAL NOT NULL DEFAULT 0,
    "ratePerMaund" DECIMAL NOT NULL DEFAULT 0,
    "amount" DECIMAL NOT NULL DEFAULT 0,
    "bardanaQty" DECIMAL,
    "bardanaRate" DECIMAL,
    "bardanaAmount" DECIMAL,
    "dammiChecked" BOOLEAN NOT NULL DEFAULT false,
    "dammiAmount" DECIMAL NOT NULL DEFAULT 0,
    "netCreditToParty" DECIMAL NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PurchaseMaalLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseMaalLine_partyAccountId_fkey" FOREIGN KEY ("partyAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PurchaseMaalLine_invoiceId_idx" ON "PurchaseMaalLine"("invoiceId");

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
    "lowerBardanaMode" TEXT,
    "lowerBardanaQty" DECIMAL,
    "lowerBardanaRate" DECIMAL,
    "lowerBardanaAmount" DECIMAL,
    "marketFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mazduriEnabled" BOOLEAN NOT NULL DEFAULT false,
    "financialYearId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" (
    "id", "type", "status", "reference", "customerId", "supplierId", "total", "notes",
    "invoiceDate", "billNo", "gariNo", "jins", "qism", "tafseel", "debitAccountId",
    "miscAmount", "lowerBardanaMode", "lowerBardanaQty", "lowerBardanaRate", "lowerBardanaAmount",
    "marketFeeEnabled", "mazduriEnabled", "financialYearId", "createdById", "createdAt", "updatedAt"
)
SELECT
    "id", "type", "status", "reference", "customerId", "supplierId", "total", "notes",
    "invoiceDate", "billNo", "gariNo", "jins", "qism", "tafseel", "debitAccountId",
    "miscAmount", "lowerBardanaMode", "lowerBardanaQty", "lowerBardanaRate", "lowerBardanaAmount",
    false, false, "financialYearId", "createdById", "createdAt", "updatedAt"
FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_reference_key" ON "Invoice"("reference");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
