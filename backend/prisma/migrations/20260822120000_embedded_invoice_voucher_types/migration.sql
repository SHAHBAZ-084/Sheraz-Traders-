-- Add embedded invoice voucher types and optional receipt/payment fields on Invoice.

-- Redefine Voucher.type enum values (SQLite table rebuild via Prisma).
-- Prisma migrate deploy handles enum extension; this migration adds invoice columns.

ALTER TABLE "Invoice" ADD COLUMN "embeddedReceiptAmount" DECIMAL;
ALTER TABLE "Invoice" ADD COLUMN "embeddedReceiptAccountId" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN "embeddedPaymentAmount" DECIMAL;
ALTER TABLE "Invoice" ADD COLUMN "embeddedPaymentAccountId" INTEGER;

-- VoucherType enum extension: SALE_RECEIPT, PURCHASE_PAYMENT
-- SQLite stores enums as TEXT; new values require no ALTER on Voucher table.
