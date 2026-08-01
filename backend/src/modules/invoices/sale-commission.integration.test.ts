import { AccountType, BoriThelaMode } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  ensureSaleCommissionAccounts,
  getTrialBalance,
  KACHI_MAAL_CATEGORY_NAMES,
} from '../accounting/accounting.service';
import { updateSystemPreferences } from '../preferences/preferences.service';
import { roundMoney } from './sale-commission.calculations';
import { createSaleCommissionInvoice } from './sale-commission.service';

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

async function voucherLegs(voucherId: number) {
  const entries = await prisma.ledgerEntry.findMany({
    where: { voucherId, isReversal: false },
    include: { ledger: { include: { account: true } } },
    orderBy: { id: 'asc' },
  });
  return entries.map((entry) => ({
    accountId: entry.ledger.accountId,
    accountName: entry.ledger.account.name,
    type: entry.type,
    amount: Number(entry.amount),
    description: entry.notes,
  }));
}

describe('Sale on Commission posting', () => {
  let userId: number;
  let purchasePartyId: number;
  let purchasePartyBId: number;
  let salePartyId: number;
  let commissionId: number;
  let dalaliId: number;
  let sutliId: number;
  let mazduriId: number;
  let marketFeeId: number;
  let munshianaId: number;
  let miscId: number;
  let thelaId: number;
  let boriId: number;
  let invoiceDate: string;

  beforeAll(async () => {
    invoiceDate = await voucherDateInActiveYear();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    await updateSystemPreferences({
      daamiPercent: 1.6,
      commissionPercent: 1,
      dalaliPercent: 0.5,
      sutliRate: 2,
      mazduriPerBagRate: 40,
      marketFeeRate: 1.2,
    });

    await prisma.$transaction(async (tx) => {
      const system = await ensureSaleCommissionAccounts(tx);
      commissionId = system.commission.id;
      dalaliId = system.dalali.id;
      sutliId = system.sutli.id;
      mazduriId = system.mazduri.id;
      marketFeeId = system.marketFee.id;
      munshianaId = system.munshiana.id;
      miscId = system.misc.id;
      thelaId = system.thela.id;
      boriId = system.bori.id;
    });

    purchasePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE,
        'SC Seller A',
        AccountType.LIABILITY,
        'SC-SELL-A',
      )
    ).id;
    purchasePartyBId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE,
        'SC Seller B',
        AccountType.LIABILITY,
        'SC-SELL-B',
      )
    ).id;
    salePartyId = (
      await ensureAccountInCategory(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        'SC Mill Buyer',
        AccountType.ASSET,
        'SC-BUY-A',
      )
    ).id;
  });

  it('balances: one Sale Party net debit equals all purchase + fee credits', async () => {
    // Sample-verified goods: 6000kg @ 4275 → 641250 + dammi 10260
    const invoice = await createSaleCommissionInvoice({
      invoiceDate,
      salePartyAccountId: salePartyId,
      billNo: 'SC-BILL-1',
      gariNo: 'LEI-3292',
      jins: 'Wheat',
      munshianaAmount: 500,
      miscAmount: 100,
      lowerBardanaMode: BoriThelaMode.THELA,
      lowerBardanaQty: 552,
      lowerBardanaRate: 45,
      lines: [
        {
          partyAccountId: purchasePartyId,
          jins: 'Wheat',
          boriOrThelaMode: BoriThelaMode.THELA,
          bagCount: 551,
          bhartii: 10,
          dharanCount: 0,
          looseKg: 490,
          ratePerMaund: 4275,
          dammiChecked: true,
        },
      ],
      createdById: userId,
    });

    expect(invoice.reference).toMatch(/^SC-/);
    expect(invoice.type).toBe('SALE_COMMISSION');
    expect(invoice.legacyInventoryPosting).toBe(false);
    expect(invoice.productId).toBeNull();

    const voucher = invoice.vouchers[0]!.voucher;
    expect(voucher.type).toBe('SALE_COMMISSION');

    const legs = await voucherLegs(voucher.id);
    const totalDebit = roundMoney(
      legs.filter((l) => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0),
    );
    const totalCredit = roundMoney(
      legs.filter((l) => l.type === 'CREDIT').reduce((s, l) => s + l.amount, 0),
    );
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(Number(invoice.total));
    expect(Number(invoice.total)).toBe(710_474.55);

    const salePartyDebits = legs.filter((l) => l.type === 'DEBIT' && l.accountId === salePartyId);
    expect(salePartyDebits).toHaveLength(1);
    expect(salePartyDebits[0]!.amount).toBe(Number(invoice.total));
    expect(salePartyDebits[0]!.description).toContain('Wheat');
    expect(salePartyDebits[0]!.description).toContain('6000 kg @ Rs');
    expect(salePartyDebits[0]!.description).not.toContain('Bill#');
    expect(salePartyDebits[0]!.description).toContain('Gari#: LEI-3292');

    expect(legs).toEqual(
      expect.arrayContaining([
        {
          accountId: salePartyId,
          accountName: expect.any(String),
          type: 'DEBIT',
          amount: 710_474.55,
          description: expect.stringContaining('6000 kg @ Rs'),
        },
        {
          accountId: purchasePartyId,
          accountName: expect.any(String),
          type: 'CREDIT',
          amount: 651_510,
          description: expect.stringContaining('6000 kg @ Rs'),
        },
        { accountId: commissionId, accountName: expect.any(String), type: 'CREDIT', amount: 6_515.1, description: 'Commission' },
        { accountId: dalaliId, accountName: expect.any(String), type: 'CREDIT', amount: 3_206.25, description: 'Dalali' },
        { accountId: sutliId, accountName: expect.any(String), type: 'CREDIT', amount: 1_102, description: 'Sutli' },
        { accountId: mazduriId, accountName: expect.any(String), type: 'CREDIT', amount: 22_040, description: 'Labour (Mazduri)' },
        { accountId: marketFeeId, accountName: expect.any(String), type: 'CREDIT', amount: 661.2, description: 'Market Fee' },
        { accountId: munshianaId, accountName: expect.any(String), type: 'CREDIT', amount: 500, description: 'Munshiana' },
        { accountId: miscId, accountName: expect.any(String), type: 'CREDIT', amount: 100, description: 'Misc' },
        { accountId: thelaId, accountName: expect.any(String), type: 'CREDIT', amount: 24_840, description: expect.stringMatching(/^Bardana against SC-/) },
      ]),
    );

    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });

  it('posts one Sale Party debit and combined purchase-party credits per row', async () => {
    const invoice = await createSaleCommissionInvoice({
      invoiceDate,
      salePartyAccountId: salePartyId,
      billNo: 'SC-BILL-2',
      munshianaAmount: 0,
      miscAmount: 0,
      lowerBardanaMode: null,
      lowerBardanaQty: null,
      lowerBardanaRate: null,
      lines: [
        {
          partyAccountId: purchasePartyBId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 10,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
          dammiChecked: true,
        },
        {
          partyAccountId: purchasePartyBId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 5,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
          dammiChecked: false,
        },
      ],
      createdById: userId,
    });

    const voucher = invoice.vouchers[0]!.voucher;
    const legs = await voucherLegs(voucher.id);

    const salePartyDebits = legs.filter((l) => l.type === 'DEBIT' && l.accountId === salePartyId);
    expect(salePartyDebits).toHaveLength(1);
    expect(salePartyDebits[0]!.amount).toBe(Number(invoice.total));

    // Row1: 50000 goods + 800 dammi = 50800; Row2: 25000 goods
    const partyCredits = legs.filter(
      (l) => l.type === 'CREDIT' && l.accountId === purchasePartyBId,
    );
    expect(partyCredits).toHaveLength(2);
    expect(partyCredits.map((l) => l.amount).sort((a, b) => a - b)).toEqual([25_000, 50_800]);

    const totalDebit = roundMoney(
      legs.filter((l) => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0),
    );
    const totalCredit = roundMoney(
      legs.filter((l) => l.type === 'CREDIT').reduce((s, l) => s + l.amount, 0),
    );
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(Number(invoice.total));
  });

  it('posts row bardana as Dr Bardana (Bori/Thela) and Cr purchase party', async () => {
    const invoice = await createSaleCommissionInvoice({
      invoiceDate,
      salePartyAccountId: salePartyId,
      billNo: 'SC-BILL-3',
      munshianaAmount: 0,
      miscAmount: 0,
      lowerBardanaMode: null,
      lowerBardanaQty: null,
      lowerBardanaRate: null,
      lines: [
        {
          partyAccountId: purchasePartyId,
          boriOrThelaMode: BoriThelaMode.BORI,
          bagCount: 10,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
          bardanaQty: 10,
          bardanaRate: 50,
          dammiChecked: false,
        },
        {
          partyAccountId: purchasePartyBId,
          boriOrThelaMode: BoriThelaMode.THELA,
          bagCount: 5,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 2000,
          bardanaQty: 5,
          bardanaRate: 40,
          dammiChecked: false,
        },
      ],
      createdById: userId,
    });

    const voucher = invoice.vouchers[0]!.voucher;
    const legs = await voucherLegs(voucher.id);

    expect(legs).toEqual(
      expect.arrayContaining([
        {
          accountId: boriId,
          accountName: expect.any(String),
          type: 'DEBIT',
          amount: 500,
          description: expect.stringMatching(/^Bardana against SC-/),
        },
        {
          accountId: purchasePartyId,
          accountName: expect.any(String),
          type: 'CREDIT',
          amount: 500,
          description: expect.stringMatching(/^Bardana against SC-/),
        },
        {
          accountId: thelaId,
          accountName: expect.any(String),
          type: 'DEBIT',
          amount: 200,
          description: expect.stringMatching(/^Bardana against SC-/),
        },
        {
          accountId: purchasePartyBId,
          accountName: expect.any(String),
          type: 'CREDIT',
          amount: 200,
          description: expect.stringMatching(/^Bardana against SC-/),
        },
      ]),
    );

    const salePartyDebits = legs.filter((l) => l.type === 'DEBIT' && l.accountId === salePartyId);
    expect(salePartyDebits).toHaveLength(1);
    expect(salePartyDebits[0]!.amount).toBe(Number(invoice.total));

    const totalDebit = roundMoney(
      legs.filter((l) => l.type === 'DEBIT').reduce((s, l) => s + l.amount, 0),
    );
    const totalCredit = roundMoney(
      legs.filter((l) => l.type === 'CREDIT').reduce((s, l) => s + l.amount, 0),
    );
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(roundMoney(Number(invoice.total) + 500 + 200));
  });
});
