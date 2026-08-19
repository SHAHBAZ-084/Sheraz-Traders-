import { AccountType, FinancialYearStatus, Role } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  assertVoucherDateInActiveFinancialYear,
  bootstrapChartOfAccounts,
  KACHI_MAAL_CATEGORY_NAMES,
} from '../accounting/accounting.service';
import { parseVoucherDateInput } from '../accounting/ledger-utils';
import { createProduct } from '../products/products.service';
import { createStore } from '../stores/stores.service';
import { createPurchaseInvoice } from './purchase-invoice.service';
import { createSaleInvoice } from './sale-invoice.service';
import { createKachiMaalInvoice } from './kachi-maal.service';

async function ensureParty(categoryName: string, name: string, type: AccountType, code: string) {
  const category = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: categoryName },
  });
  if (!category) throw new Error(`Missing category ${categoryName}`);
  let account = await prisma.account.findFirst({ where: { code }, include: { ledger: true } });
  if (!account) {
    account = await prisma.account.create({
      data: { categoryId: category.id, name, code, type },
      include: { ledger: true },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  } else if (!account.ledger) {
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
  }
  return account;
}

describe('Invoice date must fall in active financial year', () => {
  let adminId: number;
  let salePartyId: number;
  let purchasePartyId: number;
  let productId: number;
  let storeId: number;
  let fyStart: Date;
  let fyEnd: Date | null;

  beforeAll(async () => {
    await bootstrapChartOfAccounts();
    const admin = await prisma.user.findFirst({ where: { role: Role.ADMIN } });
    if (!admin) throw new Error('Seed admin first');
    adminId = admin.id;

    const fy = await prisma.financialYear.findFirst({ where: { status: FinancialYearStatus.ACTIVE } });
    if (!fy) throw new Error('No active FY');
    fyStart = fy.startDate;
    fyEnd = fy.endDate;

    salePartyId = (
      await ensureParty(
        KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
        `FY Date Sale Party ${Date.now()}`,
        AccountType.ASSET,
        `FY-SI-${Date.now()}`,
      )
    ).id;
    purchasePartyId = (
      await ensureParty(
        KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY,
        `FY Date Purchase Party ${Date.now()}`,
        AccountType.LIABILITY,
        `FY-PI-${Date.now()}`,
      )
    ).id;

    storeId = (await createStore(`FY Date Store ${Date.now()}`)).id;
    productId = (
      await createProduct({
        name: `FY Date Product ${Date.now()}`,
        openingStock: 10,
        openingStockRate: 10,
        openingStoreId: storeId,
      })
    ).id;
  });

  function inRangeDate(): string {
    const d = new Date(fyStart);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  }

  function beforeFyDate(): string {
    const d = new Date(fyStart);
    d.setUTCFullYear(d.getUTCFullYear() - 4);
    return d.toISOString().slice(0, 10);
  }

  function afterFyDate(): string {
    if (fyEnd) {
      const d = new Date(fyEnd);
      d.setUTCDate(d.getUTCDate() + 45);
      return d.toISOString().slice(0, 10);
    }
    const d = new Date(fyStart);
    d.setUTCFullYear(d.getUTCFullYear() + 2);
    return d.toISOString().slice(0, 10);
  }

  it('rejects sale invoice dated before active FY', async () => {
    await expect(
      createSaleInvoice({
        invoiceDate: beforeFyDate(),
        storeId,
        customerAccountId: salePartyId,
        createdById: adminId,
        lines: [{ productId, quantity: 1, rate: 100 }],
      }),
    ).rejects.toThrow(/Invoice date is before the active financial year/);
  });

  it('rejects sale invoice dated after active FY when end date is set', async () => {
    if (!fyEnd) return;
    await expect(
      createSaleInvoice({
        invoiceDate: afterFyDate(),
        storeId,
        customerAccountId: salePartyId,
        createdById: adminId,
        lines: [{ productId, quantity: 1, rate: 100 }],
      }),
    ).rejects.toThrow(/Invoice date is after the active financial year/);
  });

  it('accepts sale invoice dated within active FY', async () => {
    const invoice = await createSaleInvoice({
      invoiceDate: inRangeDate(),
      storeId,
      customerAccountId: salePartyId,
      createdById: adminId,
      lines: [{ productId, quantity: 1, rate: 100 }],
    });
    expect(invoice.id).toBeTruthy();
  });

  it('rejects purchase invoice dated before active FY', async () => {
    await expect(
      createPurchaseInvoice({
        invoiceDate: beforeFyDate(),
        storeId,
        supplierAccountId: purchasePartyId,
        createdById: adminId,
        lines: [{ productId, quantity: 1, rate: 50 }],
      }),
    ).rejects.toThrow(/Invoice date is before the active financial year/);
  });

  it('accepts purchase invoice dated within active FY', async () => {
    const invoice = await createPurchaseInvoice({
      invoiceDate: inRangeDate(),
      storeId,
      supplierAccountId: purchasePartyId,
      createdById: adminId,
      lines: [{ productId, quantity: 1, rate: 50 }],
    });
    expect(invoice.id).toBeTruthy();
  });

  it('rejects kachi maal dated before active FY', async () => {
    await expect(
      createKachiMaalInvoice({
        invoiceDate: beforeFyDate(),
        debitAccountId: salePartyId,
        createdById: adminId,
        lines: [
          {
            partyAccountId: purchasePartyId,
            bagCount: 1,
            bhartii: 100,
            dharanCount: 0,
            looseKg: 0,
            ratePerMaund: 1000,
          },
        ],
      }),
    ).rejects.toThrow(/Invoice date is before the active financial year/);
  });

  it('accepts kachi maal dated within active FY', async () => {
    const invoice = await createKachiMaalInvoice({
      invoiceDate: inRangeDate(),
      debitAccountId: salePartyId,
      createdById: adminId,
      lines: [
        {
          partyAccountId: purchasePartyId,
          bagCount: 1,
          bhartii: 100,
          dharanCount: 0,
          looseKg: 0,
          ratePerMaund: 1000,
        },
      ],
    });
    expect(invoice.id).toBeTruthy();
  });

  it('keeps voucher wording for assertVoucherDateInActiveFinancialYear default label', async () => {
    await expect(
      assertVoucherDateInActiveFinancialYear(prisma, parseVoucherDateInput(beforeFyDate())),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      assertVoucherDateInActiveFinancialYear(prisma, parseVoucherDateInput(beforeFyDate())),
    ).rejects.toThrow(/Voucher date is before the active financial year/);
  });
});
