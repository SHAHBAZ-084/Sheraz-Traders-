-- Sale on Commission lines, prefs, and invoice munshiana
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

ALTER TABLE "SystemPreference" ADD COLUMN "mazduriPerBagRate" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "munshianaAmount" DECIMAL NOT NULL DEFAULT 0;

CREATE TABLE "SaleCommissionLine" (
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
    CONSTRAINT "SaleCommissionLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SaleCommissionLine_partyAccountId_fkey" FOREIGN KEY ("partyAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SaleCommissionLine_invoiceId_idx" ON "SaleCommissionLine"("invoiceId");
CREATE INDEX "SaleCommissionLine_partyAccountId_idx" ON "SaleCommissionLine"("partyAccountId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
