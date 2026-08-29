-- Persist multi-line embedded Cash/Bank receipts/payments on the invoice until the
-- invoice voucher posts (payment legs are folded into SALE_INVOICE / PURCHASE_INVOICE).
ALTER TABLE "Invoice" ADD COLUMN "embeddedReceiptLines" JSONB;
ALTER TABLE "Invoice" ADD COLUMN "embeddedPaymentLines" JSONB;
