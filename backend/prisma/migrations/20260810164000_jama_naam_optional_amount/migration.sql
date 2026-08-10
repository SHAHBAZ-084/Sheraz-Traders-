-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JamaNaamEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partyId" INTEGER NOT NULL,
    "productId" INTEGER,
    "quantity" DECIMAL,
    "amount" DECIMAL,
    "direction" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JamaNaamEntry_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JamaNaamEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_JamaNaamEntry" ("id", "partyId", "productId", "quantity", "direction", "date", "notes", "createdAt")
SELECT "id", "partyId", "productId", "quantity", "direction", "date", "notes", "createdAt" FROM "JamaNaamEntry";
DROP TABLE "JamaNaamEntry";
ALTER TABLE "new_JamaNaamEntry" RENAME TO "JamaNaamEntry";
CREATE INDEX "JamaNaamEntry_date_id_idx" ON "JamaNaamEntry"("date", "id");
CREATE INDEX "JamaNaamEntry_partyId_idx" ON "JamaNaamEntry"("partyId");
CREATE INDEX "JamaNaamEntry_productId_idx" ON "JamaNaamEntry"("productId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
