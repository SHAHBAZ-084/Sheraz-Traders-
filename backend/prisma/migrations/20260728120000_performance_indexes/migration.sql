-- Performance indexes for high-traffic lookups and composite query patterns.

-- CreateIndex
CREATE INDEX "Account_categoryId_idx" ON "Account"("categoryId");

-- CreateIndex
CREATE INDEX "LedgerEntry_voucherId_idx" ON "LedgerEntry"("voucherId");

-- CreateIndex
CREATE INDEX "LedgerEntry_ledgerId_createdAt_idx" ON "LedgerEntry"("ledgerId", "createdAt");

-- CreateIndex
CREATE INDEX "Voucher_debitAccountId_idx" ON "Voucher"("debitAccountId");

-- CreateIndex
CREATE INDEX "Voucher_creditAccountId_idx" ON "Voucher"("creditAccountId");

-- CreateIndex
CREATE INDEX "Invoice_financialYearId_idx" ON "Invoice"("financialYearId");

-- CreateIndex
CREATE INDEX "Invoice_financialYearId_type_status_idx" ON "Invoice"("financialYearId", "type", "status");

-- CreateIndex
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");

-- CreateIndex
CREATE INDEX "KachiMaalLine_partyAccountId_idx" ON "KachiMaalLine"("partyAccountId");

-- CreateIndex
CREATE INDEX "PurchaseMaalLine_partyAccountId_idx" ON "PurchaseMaalLine"("partyAccountId");

-- CreateIndex
CREATE INDEX "SalePaunchLine_maalKhataAccountId_idx" ON "SalePaunchLine"("maalKhataAccountId");
