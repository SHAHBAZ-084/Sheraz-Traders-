-- CreateEnum
CREATE TABLE IF NOT EXISTS "StockRemainder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "bagType" TEXT NOT NULL,
    "remainderKg" DECIMAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockRemainder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "StockMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "bagType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "bags" DECIMAL NOT NULL,
    "date" DATETIME NOT NULL,
    "invoiceId" INTEGER,
    "invoiceType" TEXT NOT NULL,
    "invoiceReference" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StockRemainder_productId_bagType_key" ON "StockRemainder"("productId", "bagType");
CREATE INDEX "StockRemainder_productId_idx" ON "StockRemainder"("productId");
CREATE INDEX "StockMovement_productId_bagType_date_id_idx" ON "StockMovement"("productId", "bagType", "date", "id");
CREATE INDEX "StockMovement_invoiceId_idx" ON "StockMovement"("invoiceId");
