-- CreateTable
CREATE TABLE "JamaNaamEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partyId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "direction" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JamaNaamEntry_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JamaNaamEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "JamaNaamEntry_date_id_idx" ON "JamaNaamEntry"("date", "id");
CREATE INDEX "JamaNaamEntry_partyId_idx" ON "JamaNaamEntry"("partyId");
CREATE INDEX "JamaNaamEntry_productId_idx" ON "JamaNaamEntry"("productId");
