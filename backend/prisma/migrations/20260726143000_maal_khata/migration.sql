-- Maal Khata: per-product inventory ledgers + purchase invoice product link

UPDATE "AccountCategory"
SET "name" = 'Maal Khata'
WHERE "name" = 'Products' AND "isActive" = 1;

INSERT INTO "AccountCategory" ("name", "isActive", "createdAt")
SELECT 'Maal Khata', 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "AccountCategory" WHERE "name" = 'Maal Khata' AND "isActive" = 1
);

UPDATE "Account"
SET "name" = (
  SELECT 'Maal Khata ' || "Product"."name"
  FROM "Product"
  WHERE "Product"."accountId" = "Account"."id"
)
WHERE "id" IN (SELECT "accountId" FROM "Product" WHERE "isActive" = 1);

UPDATE "Account"
SET "categoryId" = (
  SELECT "id" FROM "AccountCategory" WHERE "name" = 'Maal Khata' AND "isActive" = 1 LIMIT 1
)
WHERE "id" IN (SELECT "accountId" FROM "Product" WHERE "isActive" = 1);

ALTER TABLE "Invoice" ADD COLUMN "productId" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN "legacyInventoryPosting" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Invoice"
SET "legacyInventoryPosting" = true
WHERE "type" = 'PURCHASE_MAAL';

CREATE INDEX "Invoice_productId_idx" ON "Invoice"("productId");
