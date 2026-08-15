-- Sale Paunch: computer weight + dual kaat (upper/lower); thela count for stock.
ALTER TABLE "SalePaunchLine" ADD COLUMN "thelaCount" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "SalePaunchLine" ADD COLUMN "lowerKaatKg" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "SalePaunchLine" ADD COLUMN "lowerNetWeightKg" DECIMAL NOT NULL DEFAULT 0;
