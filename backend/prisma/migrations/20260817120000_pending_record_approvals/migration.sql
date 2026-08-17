-- RecordStatus + pending fields for Account/Product, and PendingAdjustment table.

ALTER TABLE "Account" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Account" ADD COLUMN "createdById" INTEGER;
ALTER TABLE "Account" ADD COLUMN "pendingOpeningBalance" DECIMAL;
ALTER TABLE "Account" ADD COLUMN "pendingOpeningSide" TEXT;

CREATE INDEX "Account_status_idx" ON "Account"("status");

ALTER TABLE "Product" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Product" ADD COLUMN "createdById" INTEGER;
ALTER TABLE "Product" ADD COLUMN "pendingOpeningStoreId" INTEGER;
ALTER TABLE "Product" ADD COLUMN "pendingOpeningQty" DECIMAL;
ALTER TABLE "Product" ADD COLUMN "pendingOpeningRate" DECIMAL;
ALTER TABLE "Product" ADD COLUMN "pendingKachiOpening" TEXT;

CREATE INDEX "Product_status_idx" ON "Product"("status");

CREATE TABLE "PendingAdjustment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "adjustmentDate" DATETIME NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" INTEGER,
    "amount" DECIMAL,
    "side" TEXT,
    "productId" INTEGER,
    "storeId" INTEGER,
    "quantity" DECIMAL,
    "rate" DECIMAL,
    "kachiOpening" TEXT,
    CONSTRAINT "PendingAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PendingAdjustment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PendingAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PendingAdjustment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "PendingAdjustment_status_idx" ON "PendingAdjustment"("status");
CREATE INDEX "PendingAdjustment_kind_status_idx" ON "PendingAdjustment"("kind", "status");
