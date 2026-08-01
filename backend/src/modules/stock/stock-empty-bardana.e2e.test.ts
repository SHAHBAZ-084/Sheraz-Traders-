/**
 * End-to-end scenario for Product Stock + Empty Bardana reports.
 *
 * Dharan note: form field is a count of 5 kg units.
 *   "Dharan: 15 kg" → dharanCount = 3 → 15 kg
 *   "Dharan: 10 kg" → dharanCount = 2 → 10 kg
 */
import { AccountType, BoriThelaMode } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  ensureKachiMaalAccounts,
  ensureSalePaunchAccounts,
  KACHI_MAAL_CATEGORY_NAMES,
} from '../accounting/accounting.service';
import {
  getEmptyBardanaReport,
} from '../inventory/bardana.service';
import { createProduct, MAAL_KHATA_CATEGORY_NAME } from '../products/products.service';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import { updateSystemPreferences } from '../preferences/preferences.service';
import { createPurchaseMaalInvoice } from '../invoices/purchase-maal.service';
import { createSalePaunchInvoice } from '../invoices/sale-paunch.service';
import { getStockReport } from './stock.service';

async function ensureAccountInCategory(
  categoryName: string,
  accountName: string,
  type: AccountType,
  code: string,
) {
  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: categoryName },
  });
  if (!category) throw new Error(`Category missing: ${categoryName}`);

  let account = await prisma.account.findFirst({
    where: { isActive: true, name: accountName, categoryId: category.id },
    include: { ledger: true },
  });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name: accountName, code, type },
      include: { ledger: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  } else if (!account.ledger) {
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  }
  return account;
}

function printStockTable(label: string, report: Awaited<ReturnType<typeof getStockReport>>) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);
  // eslint-disable-next-line no-console
  console.log(
    'Date | Description | Status | Bags | Running | carriedRemainderKg=',
    report.carriedRemainderKg,
  );
  for (const row of report.rows) {
    // eslint-disable-next-line no-console
    console.log(
      `${row.date.slice(0, 10)} | ${row.description} | ${row.status} | ${row.bags} | ${row.runningBalance}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `Totals: In=${report.totals.totalIn} Out=${report.totals.totalOut} Net=${report.totals.netBalance}`,
  );
}

function printEmptyBardana(label: string, report: Awaited<ReturnType<typeof getEmptyBardanaReport>>) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);
  for (const b of report.balances) {
    // eslint-disable-next-line no-console
    console.log(`Balance ${b.bagType}: ${b.balance}`);
  }
  // eslint-disable-next-line no-console
  console.log('Recent movements (newest first, filtered later in asserts):');
  for (const m of report.movements.slice(0, 20)) {
    // eslint-disable-next-line no-console
    console.log(
      `${m.date.slice(0, 10)} | ${m.description ?? m.source} | ${m.bagType} | ${m.direction} | ${m.qty}`,
    );
  }
}

describe('Stock + Empty Bardana E2E scenario', () => {
  let userId: number;
  let partyId: number;
  let salePartyId: number;
  let wheatProductId: number;
  let wheatMaalKhataId: number;
  let invoiceDate: string;
  const stamp = Date.now();
  const refs: string[] = [];

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    await updateSystemPreferences({ daamiPercent: 1.6, mazduriPercent: 2, marketFeeRate: 2, kaatPercent: 2 });

    await prisma.$transaction(async (tx) => {
      await ensureKachiMaalAccounts(tx);
      await ensureSalePaunchAccounts(tx);
    });

    partyId = (await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE,
      `Party Stock E2E ${stamp}`,
      AccountType.LIABILITY,
      `STK-PARTY-${stamp}`,
    )).id;

    salePartyId = (await ensureAccountInCategory(
      KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
      `Sale Party Stock E2E ${stamp}`,
      AccountType.ASSET,
      `STK-SALE-${stamp}`,
    )).id;

    const wheat = await createProduct({ name: `Wheat Stock E2E ${stamp}` });
    const category = await prisma.accountCategory.findUnique({ where: { id: wheat.account.categoryId } });
    expect(category?.name).toBe(MAAL_KHATA_CATEGORY_NAME);
    wheatProductId = wheat.id;
    wheatMaalKhataId = wheat.accountId;

    // Seed Empty Bardana Bori = 50 so reductions stay readable (negatives also allowed).
    await prisma.emptyBardanaBalance.upsert({
      where: { bagType: 'BORI' },
      create: { bagType: 'BORI', balance: 50 },
      update: { balance: 50 },
    });
    await prisma.emptyBardanaBalance.upsert({
      where: { bagType: 'THELA' },
      create: { bagType: 'THELA', balance: 0 },
      update: {},
    });
  });

  it('runs Steps 1–4 and matches expected Product Stock + Empty Bardana math', async () => {
    const boriBeforeStep1 = (await getEmptyBardanaReport()).balances.find((b) => b.bagType === 'BORI')!.balance;
    expect(boriBeforeStep1).toBe(50);

    // --- Step 1: PM without bardana, 10 bori, loose 25 kg (dharan 3×5 + kilo 10) ---
    const pm1 = await createPurchaseMaalInvoice({
      invoiceDate,
      billNo: `STK-PM1-${stamp}`,
      productId: wheatProductId,
      marketFeeEnabled: false,
      mazduriEnabled: false,
      lines: [
        {
          partyAccountId: partyId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 10,
          bhartii: 40,
          dharanCount: 3, // 15 kg
          looseKg: 10,
          ratePerMaund: 2000,
          bardanaQty: 0,
          bardanaRate: null,
        },
      ],
      createdById: userId,
    });
    refs.push(pm1.reference);

    let stock = await getStockReport({ productId: wheatProductId, bagType: 'BORI' });
    printStockTable('After Step 1 — Product Stock (Wheat, Bori)', stock);
    expect(stock.rows).toHaveLength(1);
    expect(stock.rows[0]!.status).toBe('IN');
    expect(stock.rows[0]!.bags).toBe(10);
    expect(stock.rows[0]!.runningBalance).toBe(10);
    expect(stock.carriedRemainderKg).toBe(25);
    expect(stock.totals).toEqual({
      totalIn: 10,
      totalOut: 0,
      netBalance: 10,
      saleInvoiceQty: 0,
      purchaseInvoiceQty: 0,
    });

    let empty = await getEmptyBardanaReport();
    printEmptyBardana('After Step 1 — Empty Bardana (PM must not change)', empty);
    expect(empty.balances.find((b) => b.bagType === 'BORI')!.balance).toBe(50);

    // --- Step 2: PM without bardana, 5 bori, loose 15 kg; carried 25+15=40 → +1 bag ---
    const pm2 = await createPurchaseMaalInvoice({
      invoiceDate,
      billNo: `STK-PM2-${stamp}`,
      productId: wheatProductId,
      marketFeeEnabled: false,
      mazduriEnabled: false,
      lines: [
        {
          partyAccountId: partyId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 5,
          bhartii: 40,
          dharanCount: 2, // 10 kg
          looseKg: 5,
          ratePerMaund: 2000,
          bardanaQty: 0,
          bardanaRate: null,
        },
      ],
      createdById: userId,
    });
    refs.push(pm2.reference);

    stock = await getStockReport({ productId: wheatProductId, bagType: 'BORI' });
    printStockTable('After Step 2 — Product Stock (Wheat, Bori)', stock);
    expect(stock.rows).toHaveLength(2);
    expect(stock.rows[1]!.status).toBe('IN');
    expect(stock.rows[1]!.bags).toBe(6);
    expect(stock.rows[1]!.runningBalance).toBe(16);
    expect(stock.carriedRemainderKg).toBe(0);
    expect(stock.totals).toEqual({
      totalIn: 16,
      totalOut: 0,
      netBalance: 16,
      saleInvoiceQty: 0,
      purchaseInvoiceQty: 0,
    });

    empty = await getEmptyBardanaReport();
    printEmptyBardana('After Step 2 — Empty Bardana (still unchanged)', empty);
    expect(empty.balances.find((b) => b.bagType === 'BORI')!.balance).toBe(50);

    // --- Step 3: PM WITH bardana qty 8 — stock IN 8, empty bardana unchanged ---
    const pm3 = await createPurchaseMaalInvoice({
      invoiceDate,
      billNo: `STK-PM3-${stamp}`,
      productId: wheatProductId,
      marketFeeEnabled: false,
      mazduriEnabled: false,
      lines: [
        {
          partyAccountId: partyId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 8,
          bhartii: 40,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
          bardanaQty: 8,
          bardanaRate: 50,
        },
      ],
      createdById: userId,
    });
    refs.push(pm3.reference);

    stock = await getStockReport({ productId: wheatProductId, bagType: 'BORI' });
    printStockTable('After Step 3 — Product Stock (Wheat, Bori)', stock);
    expect(stock.rows).toHaveLength(3);
    expect(stock.rows[2]!.status).toBe('IN');
    expect(stock.rows[2]!.bags).toBe(8);
    expect(stock.rows[2]!.runningBalance).toBe(24);
    expect(stock.carriedRemainderKg).toBe(0);
    expect(stock.totals).toEqual({
      totalIn: 24,
      totalOut: 0,
      netBalance: 24,
      saleInvoiceQty: 0,
      purchaseInvoiceQty: 0,
    });

    empty = await getEmptyBardanaReport();
    printEmptyBardana('After Step 3 — Empty Bardana (still unchanged)', empty);
    expect(empty.balances.find((b) => b.bagType === 'BORI')!.balance).toBe(50);

    // --- Step 4: Sale Paunch OUT 12 — stock 12, empty bardana −12 only ---
    const sp1 = await createSalePaunchInvoice({
      invoiceDate,
      billNo: `STK-SP1-${stamp}`,
      salePartyAccountId: salePartyId,
      lines: [
        {
          maalKhataAccountId: wheatMaalKhataId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 12,
          thelaCount: 0,
          compWeightKg: 480,
          upperRatePerMaund: 2000,
          lowerRatePerMaund: 2500,
          kanta: 0,
        },
      ],
      createdById: userId,
    });
    refs.push(sp1.reference);

    stock = await getStockReport({ productId: wheatProductId, bagType: 'BORI' });
    printStockTable('FINAL — Product Stock Report (Wheat, Bori)', stock);
    expect(stock.rows.map((r) => ({ status: r.status, bags: r.bags, running: r.runningBalance }))).toEqual([
      { status: 'IN', bags: 10, running: 10 },
      { status: 'IN', bags: 6, running: 16 },
      { status: 'IN', bags: 8, running: 24 },
      { status: 'OUT', bags: 12, running: 12 },
    ]);
    expect(stock.totals).toEqual({
      totalIn: 24,
      totalOut: 12,
      netBalance: 12,
      saleInvoiceQty: 0,
      purchaseInvoiceQty: 0,
    });
    expect(stock.carriedRemainderKg).toBe(0);

    empty = await getEmptyBardanaReport();
    printEmptyBardana('FINAL — Empty Bardana Report', empty);
    const finalBori = empty.balances.find((b) => b.bagType === 'BORI')!.balance;
    expect(finalBori).toBe(38); // 50 − 12 (Sale Paunch only)

    const scenarioOuts = empty.movements.filter(
      (m) =>
        m.bagType === 'BORI'
        && m.direction === 'OUT'
        && refs.some((r) => (m.description ?? '').includes(r) || m.description === r),
    );
    const outByRef = refs.map((ref) => {
      const hit = empty.movements.find(
        (m) => m.bagType === 'BORI' && m.direction === 'OUT' && (m.description === ref || (m.description ?? '').includes(ref)),
      );
      return { ref, qty: hit?.qty ?? null, source: hit?.source ?? null };
    });
    // eslint-disable-next-line no-console
    console.log('\nEmpty Bardana OUT tied to scenario invoices:', outByRef);

    expect(outByRef[0].qty).toBeNull(); // PM1 — no empty-bardana effect
    expect(outByRef[1].qty).toBeNull(); // PM2 — no empty-bardana effect
    expect(outByRef[2].qty).toBeNull(); // PM3 — no empty-bardana effect
    expect(outByRef[3]).toMatchObject({ qty: 12, source: 'SALE_PAUNCH' });

    const totalReduced = scenarioOuts.reduce((s, m) => s + m.qty, 0);
    expect(totalReduced).toBe(12);
  });
});
