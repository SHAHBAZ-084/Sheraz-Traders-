-- Sale on Paunch lines, voucher type, and invoice settlement fields

CREATE TABLE "SalePaunchLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "maalKhataAccountId" INTEGER NOT NULL,
    "jins" TEXT,
    "qism" TEXT,
    "boriOrThelaMode" TEXT NOT NULL,
    "bagCount" DECIMAL NOT NULL DEFAULT 0,
    "bhartii" DECIMAL NOT NULL DEFAULT 0,
    "dharanCount" DECIMAL NOT NULL DEFAULT 0,
    "looseKg" DECIMAL NOT NULL DEFAULT 0,
    "totalWeightKg" DECIMAL NOT NULL DEFAULT 0,
    "upperRatePerMaund" DECIMAL NOT NULL DEFAULT 0,
    "upperAmount" DECIMAL NOT NULL DEFAULT 0,
    "kanta" DECIMAL NOT NULL DEFAULT 0,
    "netUpperAmount" DECIMAL NOT NULL DEFAULT 0,
    "lowerRatePerMaund" DECIMAL NOT NULL DEFAULT 0,
    "lowerAmount" DECIMAL NOT NULL DEFAULT 0,
    "rowRevenue" DECIMAL NOT NULL DEFAULT 0,
    "bardanaQty" DECIMAL,
    "bardanaRate" DECIMAL,
    "bardanaAmount" DECIMAL,
    "dammiChecked" BOOLEAN NOT NULL DEFAULT false,
    "dammiAmount" DECIMAL NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SalePaunchLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalePaunchLine_maalKhataAccountId_fkey" FOREIGN KEY ("maalKhataAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SalePaunchLine_invoiceId_idx" ON "SalePaunchLine"("invoiceId");

ALTER TABLE "Invoice" ADD COLUMN "taxAmount" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "biltyKirayaAmount" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "kaatEnabled" BOOLEAN NOT NULL DEFAULT false;
