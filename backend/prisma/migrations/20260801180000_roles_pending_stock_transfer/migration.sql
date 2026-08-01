-- Role on User (existing accounts become ADMIN)
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER';
UPDATE "User" SET "role" = 'ADMIN';

-- Persist store on Sale/Purchase Invoice and Stock Transfer documents
ALTER TABLE "Invoice" ADD COLUMN "storeId" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN "toStoreId" INTEGER;
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_storeId_idx" ON "Invoice"("storeId");
