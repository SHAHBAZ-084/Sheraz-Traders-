-- Empty Bardana (physical empty bags) — replaces free-text BardanaStock
DROP TABLE IF EXISTS "BardanaStock";

CREATE TABLE "EmptyBardanaBalance" (
    "bagType" TEXT NOT NULL PRIMARY KEY,
    "balance" DECIMAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "EmptyBardanaMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bagType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "qty" DECIMAL NOT NULL,
    "date" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "description" TEXT,
    "invoiceId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmptyBardanaMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "EmptyBardanaMovement_bagType_date_id_idx" ON "EmptyBardanaMovement"("bagType", "date", "id");
CREATE INDEX "EmptyBardanaMovement_invoiceId_idx" ON "EmptyBardanaMovement"("invoiceId");

INSERT INTO "EmptyBardanaBalance" ("bagType", "balance", "updatedAt") VALUES
  ('BORI', 0, CURRENT_TIMESTAMP),
  ('THELA', 0, CURRENT_TIMESTAMP);
