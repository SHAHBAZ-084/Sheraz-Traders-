-- Unified voucher register: one number sequence per financial year (all types share it).
-- Renumber existing rows so (financialYearId, number) is unique before adding the new constraint.

DROP INDEX "Voucher_financialYearId_type_number_key";

-- Avoid transient duplicate numbers while reassigning.
UPDATE "Voucher" SET "number" = "number" + 1000000 WHERE "financialYearId" IS NOT NULL;

-- Sequential numbers per financial year, ordered by voucher id (creation order).
UPDATE "Voucher"
SET "number" = (
  SELECT COUNT(*)
  FROM "Voucher" AS v2
  WHERE v2."financialYearId" = "Voucher"."financialYearId"
    AND v2."id" <= "Voucher"."id"
)
WHERE "financialYearId" IS NOT NULL;

CREATE UNIQUE INDEX "Voucher_financialYearId_number_key" ON "Voucher"("financialYearId", "number");
