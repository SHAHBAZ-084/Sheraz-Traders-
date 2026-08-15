-- CreateTable
CREATE TABLE "Store" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_name_key" ON "Store"("name");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StockRemainder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "bagType" TEXT NOT NULL,
    "storeId" INTEGER,
    "remainderKg" DECIMAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockRemainder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockRemainder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockRemainder" ("bagType", "id", "productId", "remainderKg", "updatedAt")
SELECT "bagType", "id", "productId", "remainderKg", "updatedAt" FROM "StockRemainder";
DROP TABLE "StockRemainder";
ALTER TABLE "new_StockRemainder" RENAME TO "StockRemainder";
CREATE INDEX "StockRemainder_productId_idx" ON "StockRemainder"("productId");
CREATE INDEX "StockRemainder_storeId_idx" ON "StockRemainder"("storeId");
CREATE UNIQUE INDEX "StockRemainder_productId_bagType_storeId_key" ON "StockRemainder"("productId", "bagType", "storeId");

CREATE TABLE "new_StockMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "bagType" TEXT NOT NULL,
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
INSERT INTO "new_StockMovement" ("bags", "bagType", "createdAt", "date", "description", "direction", "id", "invoiceId", "invoiceReference", "invoiceType", "productId")
SELECT "bags", "bagType", "createdAt", "date", "description", "direction", "id", "invoiceId", "invoiceReference", "invoiceType", "productId" FROM "StockMovement";
DROP TABLE "StockMovement";
ALTER TABLE "new_StockMovement" RENAME TO "StockMovement";
CREATE INDEX "StockMovement_productId_bagType_date_id_idx" ON "StockMovement"("productId", "bagType", "date", "id");
CREATE INDEX "StockMovement_invoiceId_idx" ON "StockMovement"("invoiceId");
CREATE INDEX "StockMovement_storeId_idx" ON "StockMovement"("storeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
