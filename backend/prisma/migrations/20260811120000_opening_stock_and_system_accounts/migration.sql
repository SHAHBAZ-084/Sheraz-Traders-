-- AlterTable
ALTER TABLE "Account" ADD COLUMN "excludeFromSelectors" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN "isOpeningStock" BOOLEAN NOT NULL DEFAULT false;

-- Mark existing Opening Balance Equity accounts as selector-excluded.
UPDATE "Account" SET "excludeFromSelectors" = true WHERE name = 'Opening Balance Equity';
