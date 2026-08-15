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
    "lowerBardanaMode" TEXT,
    "lowerBardanaQty" DECIMAL,
    "lowerBardanaRate" DECIMAL,
    "lowerBardanaAmount" DECIMAL,
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
INSERT INTO "new_Invoice" ("id", "type", "status", "reference", "customerId", "supplierId", "total", "notes", "financialYearId", "createdById", "createdAt", "updatedAt")
SELECT "id", "type", "status", "reference", "customerId", "supplierId", "total", "notes", "financialYearId", "createdById", "createdAt", "updatedAt" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_reference_key" ON "Invoice"("reference");

CREATE TABLE "KachiMaalLine" (
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
    "netCreditToParty" DECIMAL NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "KachiMaalLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KachiMaalLine_partyAccountId_fkey" FOREIGN KEY ("partyAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "KachiMaalLine_invoiceId_idx" ON "KachiMaalLine"("invoiceId");

CREATE TABLE "SystemPreference" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "daamiPercent" DECIMAL NOT NULL DEFAULT 0,
    "paleDariPercent" DECIMAL NOT NULL DEFAULT 0,
    "brokeryPercent" DECIMAL NOT NULL DEFAULT 0,
    "marketFeeRate" DECIMAL NOT NULL DEFAULT 0,
    "bardanaRate" DECIMAL NOT NULL DEFAULT 0,
    "taxPercent" DECIMAL NOT NULL DEFAULT 0,
    "kaatPercent" DECIMAL NOT NULL DEFAULT 0,
    "mazduriPercent" DECIMAL NOT NULL DEFAULT 0,
    "commissionPercent" DECIMAL NOT NULL DEFAULT 0,
    "dalaliPercent" DECIMAL NOT NULL DEFAULT 0,
    "sutliRate" DECIMAL NOT NULL DEFAULT 0,
    "markeetFeeRate" DECIMAL NOT NULL DEFAULT 0,
    "kantaRate" DECIMAL NOT NULL DEFAULT 0,
    "closingDate" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "SystemPreference" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
