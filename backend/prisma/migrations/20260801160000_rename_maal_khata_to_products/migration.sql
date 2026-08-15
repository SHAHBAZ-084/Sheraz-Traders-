-- Rename product inventory category "Maal Khata" → "Products" and strip the
-- "Maal Khata " prefix from ledger account display names.
-- Account IDs are unchanged so existing invoices/vouchers keep resolving.

-- 1) If only "Maal Khata" exists (no active "Products"), rename it.
UPDATE "AccountCategory"
SET "name" = 'Products'
WHERE "name" = 'Maal Khata'
  AND "isActive" = 1
  AND NOT EXISTS (
    SELECT 1
    FROM "AccountCategory" AS "other"
    WHERE "other"."name" = 'Products'
      AND "other"."isActive" = 1
  );

-- 2) If both categories exist, move accounts under "Maal Khata" into "Products".
UPDATE "Account"
SET "categoryId" = (
  SELECT "id"
  FROM "AccountCategory"
  WHERE "name" = 'Products'
    AND "isActive" = 1
  LIMIT 1
)
WHERE "categoryId" IN (
  SELECT "id"
  FROM "AccountCategory"
  WHERE "name" = 'Maal Khata'
    AND "isActive" = 1
)
AND EXISTS (
  SELECT 1
  FROM "AccountCategory"
  WHERE "name" = 'Products'
    AND "isActive" = 1
);

-- 3) Deactivate leftover "Maal Khata" category when "Products" already exists.
UPDATE "AccountCategory"
SET "isActive" = 0
WHERE "name" = 'Maal Khata'
  AND "isActive" = 1
  AND EXISTS (
    SELECT 1
    FROM "AccountCategory" AS "other"
    WHERE "other"."name" = 'Products'
      AND "other"."isActive" = 1
  );

-- 4) Strip "Maal Khata " prefix from any remaining ledger display names.
UPDATE "Account"
SET "name" = SUBSTR("name", LENGTH('Maal Khata ') + 1)
WHERE "name" LIKE 'Maal Khata %';
