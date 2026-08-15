-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN "mazduriAmount" DECIMAL NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN "mazduriAmount" DECIMAL;
