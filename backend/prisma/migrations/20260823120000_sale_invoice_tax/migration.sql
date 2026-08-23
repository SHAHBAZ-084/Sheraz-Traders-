-- Sale Invoice per-line tax deduction (flat amount, like Purchase Mazduri)
ALTER TABLE "InvoiceItem" ADD COLUMN "taxAmount" DECIMAL NOT NULL DEFAULT 0;
