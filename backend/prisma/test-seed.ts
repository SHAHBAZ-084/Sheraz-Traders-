/**
 * DEV/TEST ONLY — sample data for end-to-end app testing.
 *
 * Data source: prisma/test-seed-data.json
 *
 * Does NOT run automatically. Invoke manually after the normal seed:
 *   npm run db:seed -w backend
 *   npm run db:seed:test -w backend
 *
 * Refuses to run when SHERAZ_TRADERS_PACKAGED=1 (packaged desktop app).
 */
import fs from 'fs';
import path from 'path';
import { FinancialYearStatus, VoucherType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import {
  bootstrapChartOfAccounts,
  createAccount,
  createVoucher,
  verifyLedgerIntegrity,
} from '../src/modules/accounting/accounting.service';
import { createKachiMaalInvoice } from '../src/modules/invoices/kachi-maal.service';
import { createPurchaseInvoice } from '../src/modules/invoices/purchase-invoice.service';
import { createSaleInvoice } from '../src/modules/invoices/sale-invoice.service';
import { createPurchaseParty, createSaleParty } from '../src/modules/parties/parties.service';
import {
  createProduct,
  createProductCategory,
} from '../src/modules/products/products.service';
import { updateSystemPreferences } from '../src/modules/preferences/preferences.service';
import { createStore } from '../src/modules/stores/stores.service';
import { voucherDateInActiveYear } from '../src/test-helpers/financial-year';

const TEST_SEED_MARKER = 'HBL Main Branch';
const KACHI_DEFAULT_BHARTII = 100;

type TestSeedData = {
  bankAccounts: Array<{ name: string; category: string; openingBalance: number }>;
  purchaseParties: Array<{ name: string; location: string }>;
  saleParties: Array<{ name: string; location: string }>;
  products: {
    fertilizers: Array<{ name: string; unit: string; openingStock: number; openingStockRate: number }>;
    pesticides: Array<{ name: string; unit: string; openingStock: number; openingStockRate: number }>;
  };
  receiptVouchers: Array<{ debit: string; credit: string; amount: number; reference: string }>;
  paymentVouchers: Array<{ debit: string; credit: string; amount: number; reference: string }>;
  journalVouchers: Array<{ debit: string; credit: string; amount: number; reference: string }>;
  kachiMaalInvoices: Array<{
    jins: string;
    party: string;
    boriCount: number;
    ratePerMaund: number;
    debitAccount: string;
  }>;
  purchaseInvoices: Array<{
    product: string;
    purchaseParty: string;
    qty: number;
    rate: number;
  }>;
  saleInvoices: Array<{
    product: string;
    saleParty: string;
    qty: number;
    rate: number;
  }>;
};

function loadSeedData(): TestSeedData {
  const dataPath = path.join(process.cwd(), 'prisma', 'test-seed-data.json');
  const raw = fs.readFileSync(dataPath, 'utf8');
  return JSON.parse(raw) as TestSeedData;
}

function assertSafeToRun() {
  if (process.env.SHERAZ_TRADERS_PACKAGED === '1') {
    console.error('Test seed cannot run inside the packaged Sheeraz Traders application.');
    process.exit(1);
  }
}

async function ensureAdminUserId() {
  const user = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!user) {
    throw new Error('Admin user missing — run `npm run db:seed -w backend` first.');
  }
  return user.id;
}

async function assertActiveFinancialYear() {
  const active = await prisma.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
  });
  if (!active) {
    throw new Error('No active financial year — run `npm run db:seed -w backend` first (FY is not modified by test seed).');
  }
  console.log(`  Using existing financial year: ${active.label}`);
  return active;
}

async function findAccountByName(name: string, categoryName?: string) {
  return prisma.account.findFirst({
    where: {
      name,
      isActive: true,
      ...(categoryName ? { category: { name: categoryName } } : {}),
    },
  });
}

async function ensureBank(name: string, openingBalance: number) {
  const existing = await findAccountByName(name, 'Bank');
  if (existing) return existing;

  const bankCategory = await prisma.accountCategory.findFirstOrThrow({
    where: { name: 'Bank', isActive: true },
  });

  return createAccount({
    categoryId: bankCategory.id,
    name,
    openingBalance,
    openingBalanceSide: 'DR',
  });
}

async function ensurePurchasePartyAccount(name: string, location: string) {
  const existing = await findAccountByName(name, 'Purchase Party');
  if (existing) return existing;
  const party = await createPurchaseParty({ name, address: location });
  return prisma.account.findFirstOrThrow({ where: { id: party.id } });
}

async function ensureSalePartyAccount(name: string, location: string) {
  const existing = await findAccountByName(name, 'Sale Party');
  if (existing) return existing;
  const party = await createSaleParty({ name, address: location });
  return prisma.account.findFirstOrThrow({ where: { id: party.id } });
}

async function ensureProductCategory(name: string) {
  const existing = await prisma.productCategory.findFirst({
    where: { isActive: true, name },
  });
  if (existing) return existing;
  return createProductCategory(name);
}

async function ensureProduct(
  name: string,
  unit: string,
  categoryId: number,
  openingStock: number,
  openingStockRate: number,
  storeId: number,
) {
  const existing = await prisma.product.findFirst({
    where: { isActive: true, name },
  });
  if (existing) return existing;

  return createProduct({
    name,
    unit,
    categoryId,
    openingStock,
    openingStockRate,
    openingStoreId: storeId,
  });
}

async function ensureStore(name: string) {
  const existing = await prisma.store.findFirst({ where: { isActive: true, name } });
  if (existing) return existing;
  return createStore(name);
}

async function voucherExists(reference: string, type: VoucherType) {
  return prisma.voucher.findFirst({
    where: { reference, type, status: 'ACTIVE' },
  });
}

async function invoiceExistsByBillNo(billNo: string) {
  return prisma.invoice.findFirst({
    where: { billNo, status: 'POSTED' },
  });
}

async function main() {
  assertSafeToRun();
  const data = loadSeedData();

  const alreadySeeded = await findAccountByName(TEST_SEED_MARKER, 'Bank');
  if (alreadySeeded && process.env.FORCE_TEST_SEED !== '1') {
    console.log(
      `Test seed marker "${TEST_SEED_MARKER}" already exists — skipping (set FORCE_TEST_SEED=1 to attempt again).`,
    );
    return;
  }

  console.log('Starting test seed…');
  await assertActiveFinancialYear();
  await bootstrapChartOfAccounts();

  const userId = await ensureAdminUserId();
  const today = await voucherDateInActiveYear();

  await updateSystemPreferences({
    daamiPercent: 1.6,
    paleDariPercent: 0.85,
    brokeryPercent: 0.15,
    marketFeeRate: 0,
    marketFeeEnabled: true,
  });

  const store = await ensureStore('Main Godown');
  const fertilizersCategory = await ensureProductCategory('Fertilizers');
  const pesticidesCategory = await ensureProductCategory('Pesticides');

  const banks = new Map<string, { id: number }>();
  for (const bank of data.bankAccounts) {
    const account = await ensureBank(bank.name, bank.openingBalance);
    banks.set(bank.name, { id: account.id });
    console.log(`  Bank: ${bank.name}`);
  }

  const purchaseParties = new Map<string, { id: number }>();
  for (const party of data.purchaseParties) {
    const account = await ensurePurchasePartyAccount(party.name, party.location);
    purchaseParties.set(party.name, { id: account.id });
    console.log(`  Purchase party: ${party.name}`);
  }

  const saleParties = new Map<string, { id: number }>();
  for (const party of data.saleParties) {
    const account = await ensureSalePartyAccount(party.name, party.location);
    saleParties.set(party.name, { id: account.id });
    console.log(`  Sale party: ${party.name}`);
  }

  const products = new Map<string, { id: number }>();
  for (const product of data.products.fertilizers) {
    const row = await ensureProduct(
      product.name,
      product.unit,
      fertilizersCategory.id,
      product.openingStock,
      product.openingStockRate,
      store.id,
    );
    products.set(product.name, { id: row.id });
    console.log(`  Product (fertilizer): ${product.name}`);
  }
  for (const product of data.products.pesticides) {
    const row = await ensureProduct(
      product.name,
      product.unit,
      pesticidesCategory.id,
      product.openingStock,
      product.openingStockRate,
      store.id,
    );
    products.set(product.name, { id: row.id });
    console.log(`  Product (pesticide): ${product.name}`);
  }

  for (const row of data.receiptVouchers) {
    if (await voucherExists(row.reference, 'RECEIPT')) continue;
    await createVoucher({
      type: 'RECEIPT',
      debitAccountId: banks.get(row.debit)!.id,
      creditAccountId: saleParties.get(row.credit)!.id,
      amount: row.amount,
      date: today,
      reference: row.reference,
      createdById: userId,
    });
    console.log(`  Receipt voucher: ${row.reference}`);
  }

  for (const row of data.paymentVouchers) {
    if (await voucherExists(row.reference, 'PAYMENT')) continue;
    await createVoucher({
      type: 'PAYMENT',
      debitAccountId: purchaseParties.get(row.debit)!.id,
      creditAccountId: banks.get(row.credit)!.id,
      amount: row.amount,
      date: today,
      reference: row.reference,
      createdById: userId,
    });
    console.log(`  Payment voucher: ${row.reference}`);
  }

  for (const row of data.journalVouchers) {
    if (await voucherExists(row.reference, 'JOURNAL')) continue;
    await createVoucher({
      type: 'JOURNAL',
      debitAccountId: banks.get(row.debit)!.id,
      creditAccountId: banks.get(row.credit)!.id,
      amount: row.amount,
      date: today,
      reference: row.reference,
      createdById: userId,
    });
    console.log(`  Journal voucher: ${row.reference}`);
  }

  for (const [index, row] of data.kachiMaalInvoices.entries()) {
    const billNo = `KM-TEST-${index + 1}`;
    if (await invoiceExistsByBillNo(billNo)) continue;
    const partyId = purchaseParties.get(row.party)!.id;
    await createKachiMaalInvoice({
      invoiceDate: today,
      billNo,
      jins: row.jins,
      debitAccountId: purchaseParties.get(row.debitAccount)!.id,
      miscAmount: 0,
      lines: [
        {
          partyAccountId: partyId,
          jins: row.jins,
          bagCount: row.boriCount,
          bhartii: KACHI_DEFAULT_BHARTII,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: row.ratePerMaund,
        },
      ],
      createdById: userId,
    });
    console.log(`  Kachi Maal invoice: ${billNo} (${row.jins})`);
  }

  for (const [index, row] of data.purchaseInvoices.entries()) {
    const billNo = `PI-TEST-${index + 1}`;
    if (await invoiceExistsByBillNo(billNo)) continue;
    await createPurchaseInvoice({
      invoiceDate: today,
      billNo,
      storeId: store.id,
      supplierAccountId: purchaseParties.get(row.purchaseParty)!.id,
      createdById: userId,
      lines: [{ productId: products.get(row.product)!.id, quantity: row.qty, rate: row.rate }],
    });
    console.log(`  Purchase invoice: ${billNo} (${row.product})`);
  }

  for (const [index, row] of data.saleInvoices.entries()) {
    const billNo = `SI-TEST-${index + 1}`;
    if (await invoiceExistsByBillNo(billNo)) continue;
    await createSaleInvoice({
      invoiceDate: today,
      billNo,
      storeId: store.id,
      customerAccountId: saleParties.get(row.saleParty)!.id,
      createdById: userId,
      lines: [{ productId: products.get(row.product)!.id, quantity: row.qty, rate: row.rate }],
    });
    console.log(`  Sale invoice: ${billNo} (${row.product})`);
  }

  const integrity = await verifyLedgerIntegrity();
  if (!integrity.ok) {
    console.error('Ledger integrity check FAILED after test seed:', integrity);
    process.exit(1);
  }

  console.log('\nTest seed complete.');
  console.log(`  Banks: ${data.bankAccounts.length}`);
  console.log(`  Purchase parties: ${data.purchaseParties.length}`);
  console.log(`  Sale parties: ${data.saleParties.length}`);
  console.log(`  Products: ${data.products.fertilizers.length + data.products.pesticides.length}`);
  console.log(`  Receipt / payment / journal vouchers: 10 each`);
  console.log(`  Kachi Maal / purchase / sale invoices: 10 each`);
  console.log('  Ledger integrity: balanced ✓');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
