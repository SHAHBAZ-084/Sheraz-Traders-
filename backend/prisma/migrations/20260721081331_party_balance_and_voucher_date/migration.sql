/*
  Warnings:

  - You are about to drop the `CustomerLedger` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SupplierLedger` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `balance` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `balance` on the `Supplier` table. All the data in the column will be lost.
  - Added the required column `date` to the `Voucher` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "CustomerLedger_createdAt_idx";

-- DropIndex
DROP INDEX "CustomerLedger_customerId_idx";

-- DropIndex
DROP INDEX "SupplierLedger_createdAt_idx";

-- DropIndex
DROP INDEX "SupplierLedger_supplierId_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CustomerLedger";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SupplierLedger";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "fatherName" TEXT,
    "cnic" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Customer" ("address", "cnic", "createdAt", "email", "fatherName", "id", "isActive", "name", "phone", "updatedAt") SELECT "address", "cnic", "createdAt", "email", "fatherName", "id", "isActive", "name", "phone", "updatedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE UNIQUE INDEX "Customer_cnic_key" ON "Customer"("cnic");
CREATE TABLE "new_Supplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Supplier" ("address", "contactPerson", "createdAt", "email", "id", "isActive", "name", "phone", "updatedAt") SELECT "address", "contactPerson", "createdAt", "email", "id", "isActive", "name", "phone", "updatedAt" FROM "Supplier";
DROP TABLE "Supplier";
ALTER TABLE "new_Supplier" RENAME TO "Supplier";
CREATE TABLE "new_Voucher" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "debitAccountId" INTEGER NOT NULL,
    "creditAccountId" INTEGER NOT NULL,
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
    CONSTRAINT "Voucher_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Voucher_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Voucher_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Voucher_modifiedById_fkey" FOREIGN KEY ("modifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Voucher_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Voucher" ("amount", "createdAt", "createdById", "creditAccountId", "date", "debitAccountId", "deletedAt", "deletedById", "description", "financialYearId", "id", "modifiedById", "number", "reference", "status", "type", "updatedAt") SELECT "amount", "createdAt", "createdById", "creditAccountId", "createdAt", "debitAccountId", "deletedAt", "deletedById", "description", "financialYearId", "id", "modifiedById", "number", "reference", "status", "type", "updatedAt" FROM "Voucher";
DROP TABLE "Voucher";
ALTER TABLE "new_Voucher" RENAME TO "Voucher";
CREATE INDEX "Voucher_financialYearId_type_idx" ON "Voucher"("financialYearId", "type");
CREATE INDEX "Voucher_date_idx" ON "Voucher"("date");
CREATE INDEX "Voucher_createdAt_idx" ON "Voucher"("createdAt");
CREATE INDEX "Voucher_status_idx" ON "Voucher"("status");
CREATE UNIQUE INDEX "Voucher_financialYearId_type_number_key" ON "Voucher"("financialYearId", "type", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
