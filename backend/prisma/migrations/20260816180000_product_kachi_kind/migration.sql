-- Kachi Product type: weight-based opening stock separate from bag-based standard products.
ALTER TABLE "Product" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "StockMovement" ADD COLUMN "weightKg" DECIMAL;
