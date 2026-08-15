/**
 * Post-seed verification for test-seed-data.json (dev only).
 * Usage: DATABASE_URL=file:./data/sheraztrader.db?connection_limit=1 npx tsx scripts/verify-test-seed.ts
 */
import fs from 'fs';
import path from 'path';
import { AccountType, FinancialYearStatus, InvoiceType, VoucherType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { getProfitLossReport } from '../src/modules/accounting/profit-loss-report.service';
import { verifyLedgerIntegrity } from '../src/modules/accounting/ledger-integrity';
import { getStockReport } from '../src/modules/stock/stock.service';

type SeedData = {
  bankAccounts: Array<{ name: string; openingBalance: number }>;
  purchaseParties: Array<{ name: string }>;
  saleParties: Array<{ name: string }>;
  products: {
    fertilizers: Array<{ name: string; openingStock: number; openingStockRate?: number }>;
    pesticides: Array<{ name: string; openingStock: number; openingStockRate?: number }>;
  };
  purchaseInvoices: Array<{ product: string; qty: number }>;
  saleInvoices: Array<{ product: string; qty: number }>;
};

function loadData(): SeedData {
  const raw = fs.readFileSync(path.join(process.cwd(), 'prisma', 'test-seed-data.json'), 'utf8');
  return JSON.parse(raw) as SeedData;
}

async function main() {
  const data = loadData();
  const fy = await prisma.financialYear.findFirst({ where: { status: FinancialYearStatus.ACTIVE } });
  console.log('Active FY:', fy?.label ?? '(none)');

  const integrity = await verifyLedgerIntegrity();
  console.log('\n1. Ledger integrity:', integrity.ok ? 'balanced ✓' : 'FAILED ✗');
  if (!integrity.ok) console.log(JSON.stringify(integrity, null, 2));

  const bankCount = await prisma.account.count({
    where: { name: { in: data.bankAccounts.map((b) => b.name) } },
  });
  const purchasePartyCount = await prisma.account.count({
    where: {
      name: { in: data.purchaseParties.map((p) => p.name) },
      accountType: AccountType.PURCHASE_PARTY,
    },
  });
  const salePartyCount = await prisma.account.count({
    where: {
      name: { in: data.saleParties.map((p) => p.name) },
      accountType: AccountType.SALE_PARTY,
    },
  });
  const allProductNames = [
    ...data.products.fertilizers.map((p) => p.name),
    ...data.products.pesticides.map((p) => p.name),
  ];
  const productRows = await prisma.product.findMany({ where: { name: { in: allProductNames } } });
  console.log('\n2. Master data counts:');
  console.log(`   Banks: ${bankCount}/10, Purchase parties: ${purchasePartyCount}/5, Sale parties: ${salePartyCount}/5, Products: ${productRows.length}/20`);

  const receiptCount = await prisma.voucher.count({
    where: { type: VoucherType.RECEIPT, reference: { startsWith: 'RCPT-' } },
  });
  const paymentCount = await prisma.voucher.count({
    where: { type: VoucherType.PAYMENT, reference: { startsWith: 'PAY-' } },
  });
  const journalCount = await prisma.voucher.count({
    where: { type: VoucherType.JOURNAL, reference: { startsWith: 'JV-' } },
  });
  console.log('\n3. Vouchers posted:');
  console.log(`   Receipt: ${receiptCount}/10, Payment: ${paymentCount}/10, Journal: ${journalCount}/10`);

  const kachiCount = await prisma.invoice.count({
    where: { type: InvoiceType.KACHI_MAAL, billNo: { startsWith: 'KM-TEST-' } },
  });
  const purchaseCount = await prisma.invoice.count({
    where: { type: InvoiceType.PURCHASE_INVOICE, billNo: { startsWith: 'PI-TEST-' } },
  });
  const saleCount = await prisma.invoice.count({
    where: { type: InvoiceType.SALE_INVOICE, billNo: { startsWith: 'SI-TEST-' } },
  });
  console.log('\n4. Invoices posted:');
  console.log(`   Kachi Maal: ${kachiCount}/10, Purchase: ${purchaseCount}/10, Sale: ${saleCount}/10`);

  const hbl = await prisma.account.findFirst({
    where: { name: 'HBL Main Branch' },
    include: { ledger: true },
  });
  const iqbal = await prisma.account.findFirst({
    where: { name: 'Iqbal Farm House' },
    include: { ledger: true },
  });
  if (hbl?.ledger) {
    const entries = await prisma.ledgerEntry.findMany({
      where: { ledgerId: hbl.ledger.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 5,
      include: { voucher: { select: { reference: true, type: true } } },
    });
    console.log('\n5. Sample HBL Main Branch ledger (first 5 entries):');
    for (const e of entries) {
      const side = e.type === 'DEBIT' ? 'DR' : 'CR';
      console.log(
        `   ${e.createdAt.toISOString().slice(0, 10)} ${side} ${e.amount} — ${e.notes ?? e.voucher?.reference ?? ''}`,
      );
    }
    console.log(`   HBL ledger balance: ${Number(hbl.ledger.balance)}`);
  }
  if (iqbal?.ledger) {
    console.log(`   Iqbal Farm House ledger balance: ${Number(iqbal.ledger.balance)}`);
  }

  if (fy) {
    const pl = await getProfitLossReport({ financialYearId: fy.id });
    const rows = pl.rows ?? [];
    const productProfitRows = rows.filter((r) => r.sourceType === 'SALE_INVOICE');
    const daamiRows = rows.filter((r) => r.sourceType === 'KACHI_MAAL' && r.productName === 'Daami');
    console.log('\n6. Profit & Loss:');
    console.log(`   Total rows: ${rows.length}, Product rows: ${productProfitRows.length}, Daami rows: ${daamiRows.length}`);
    console.log(`   Net profit: ${pl.netProfit}`);
    for (const r of productProfitRows.slice(0, 3)) {
      console.log(`   ${r.productName}: profit ${r.profit}`);
    }
  }

  console.log('\n7. Stock (opening + purchases − sales):');
  const stockIssues: string[] = [];
  for (const p of [...data.products.fertilizers, ...data.products.pesticides]) {
    const prod = productRows.find((x) => x.name === p.name);
    if (!prod) {
      stockIssues.push(`${p.name}: product missing`);
      continue;
    }
    const purchaseQty = data.purchaseInvoices.find((pi) => pi.product === p.name)?.qty ?? 0;
    const saleQty = data.saleInvoices.find((si) => si.product === p.name)?.qty ?? 0;
    const expected = p.openingStock + purchaseQty - saleQty;
    const report = await getStockReport({ productId: prod.id });
    const actual = report.totals.netBalance;
    const ok = actual === expected;
    console.log(`   ${p.name}: ${actual} (expected ${expected}) ${ok ? '✓' : '✗'}`);
    if (!ok) stockIssues.push(`${p.name}: expected ${expected}, got ${actual}`);
  }

  const allOk =
    integrity.ok &&
    bankCount === 10 &&
    purchasePartyCount === 5 &&
    salePartyCount === 5 &&
    productRows.length === 20 &&
    receiptCount === 10 &&
    paymentCount === 10 &&
    journalCount === 10 &&
    kachiCount === 10 &&
    purchaseCount === 10 &&
    saleCount === 10 &&
    stockIssues.length === 0;

  console.log('\n=== Overall:', allOk ? 'ALL CHECKS PASSED ✓' : 'SOME CHECKS FAILED ✗', '===');
  if (!allOk) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
