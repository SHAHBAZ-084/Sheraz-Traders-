import {
  BoriThelaMode,
  InvoiceStatus,
  InvoiceType,
  LedgerEntryType,
  Prisma,
  VoucherType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  createMultiLegVoucherInTx,
  ensureSaleCommissionAccounts,
  getActiveFinancialYearId,
  KACHI_MAAL_CATEGORY_NAMES,
  type VoucherLeg,
} from '../accounting/accounting.service';
import { getSystemPreferences } from '../preferences/preferences.service';
import {
  computeSaleCommissionInvoiceTotals,
  computeSaleCommissionRow,
  roundMoney,
} from './sale-commission.calculations';
import {
  blendedLegDescription,
  bardanaAgainstInvoiceDescription,
  rowLegDescription,
  voucherReferenceFromBillNo,
  type InvoiceVoucherHeader,
} from './invoice-voucher-descriptions';

const TYPE_PREFIX = 'SC';

async function nextReference(tx: Prisma.TransactionClient) {
  const count = await tx.invoice.count({ where: { type: InvoiceType.SALE_COMMISSION } });
  return `${TYPE_PREFIX}-${String(count + 1).padStart(5, '0')}`;
}

export async function getNextSaleCommissionReference() {
  return prisma.$transaction(async (tx) => {
    await ensureSaleCommissionAccounts(tx);
    return { reference: await nextReference(tx) };
  });
}

export type SaleCommissionLineInput = {
  partyAccountId: number;
  jins?: string;
  qism?: string;
  boriOrThelaMode: BoriThelaMode;
  bagCount: number;
  bhartii: number;
  dharanCount: number;
  looseKg: number;
  ratePerMaund: number;
  bardanaQty?: number | null;
  bardanaRate?: number | null;
  dammiChecked?: boolean;
};

export type CreateSaleCommissionInput = {
  invoiceDate: string;
  salePartyAccountId: number;
  billNo?: string;
  gariNo?: string;
  jins?: string;
  qism?: string;
  tafseel?: string;
  munshianaAmount?: number;
  miscAmount?: number;
  lowerBardanaMode?: BoriThelaMode | null;
  lowerBardanaQty?: number | null;
  lowerBardanaRate?: number | null;
  lines: SaleCommissionLineInput[];
  createdById: number;
};

async function assertPurchasePartyAccount(tx: Prisma.TransactionClient, accountId: number) {
  const account = await tx.account.findFirst({
    where: { id: accountId, isActive: true },
    include: { category: true },
  });
  if (!account) throw new AppError(400, 'Invalid purchase party account');
  const name = account.category.name;
  if (
    name !== KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE
    && name !== KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE
  ) {
    throw new AppError(400, 'Party must be an Int. or Ext. Purchase Party account');
  }
  return account;
}

async function assertSalePartyAccount(tx: Prisma.TransactionClient, accountId: number) {
  const account = await tx.account.findFirst({
    where: { id: accountId, isActive: true },
    include: { category: true },
  });
  if (!account) throw new AppError(400, 'Invalid sale party account');
  if (account.category.name !== KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY) {
    throw new AppError(400, 'Settlement party must be a Sale Party account');
  }
  return account;
}

type ComputedLine = SaleCommissionLineInput & {
  totalWeightKg: number;
  amount: number;
  bardanaAmount: number | null;
  dammiAmount: number;
  netCreditToParty: number;
};

function buildComputedLines(
  lines: SaleCommissionLineInput[],
  prefs: { daamiPercent: number },
): ComputedLine[] {
  return lines.map((line) => {
    const computed = computeSaleCommissionRow(line, prefs);
    if (!(computed.amount > 0)) {
      throw new AppError(400, 'Each line must have a positive goods amount');
    }
    if (!(line.bhartii > 0) && !(line.looseKg > 0 || line.dharanCount > 0)) {
      throw new AppError(400, 'Each line needs weight (bhartii and/or kilo/dharan)');
    }
    return { ...line, ...computed, dammiChecked: line.dammiChecked ?? false };
  });
}

function bardanaAccountId(
  mode: BoriThelaMode,
  systemAccounts: Awaited<ReturnType<typeof ensureSaleCommissionAccounts>>,
) {
  return mode === BoriThelaMode.THELA ? systemAccounts.thela.id : systemAccounts.bori.id;
}

function toVoucherLines(lines: ComputedLine[]) {
  return lines.map((line) => ({
    totalWeightKg: line.totalWeightKg,
    ratePerMaund: line.ratePerMaund,
  }));
}

/**
 * Sale Party gets one net debit (like Sale Paunch).
 * Purchase parties / fee / bardana accounts still receive their credit legs.
 * Row bardana: Dr Bardana (Bori/Thela) / Cr purchase party — does not affect Sale Party.
 */
function buildLedgerLegs(
  salePartyAccountId: number,
  computedLines: ComputedLine[],
  totals: ReturnType<typeof computeSaleCommissionInvoiceTotals>,
  systemAccounts: Awaited<ReturnType<typeof ensureSaleCommissionAccounts>>,
  lowerBardanaMode: BoriThelaMode | null | undefined,
  header: InvoiceVoucherHeader,
  invoiceReference: string,
  product?: string | null,
) {
  const legs: VoucherLeg[] = [];
  const settlementDescription = blendedLegDescription(
    toVoucherLines(computedLines),
    header,
    product,
  );
  const bardanaDesc = bardanaAgainstInvoiceDescription(invoiceReference);

  for (const line of computedLines) {
    const goodsCredit = roundMoney(line.amount + line.dammiAmount);
    if (goodsCredit > 0) {
      legs.push({
        accountId: line.partyAccountId,
        type: LedgerEntryType.CREDIT,
        amount: goodsCredit,
        description: rowLegDescription(
          { totalWeightKg: line.totalWeightKg, ratePerMaund: line.ratePerMaund },
          header,
        ),
      });
    }

    if (line.bardanaAmount != null && line.bardanaAmount > 0) {
      legs.push(
        {
          accountId: bardanaAccountId(line.boriOrThelaMode, systemAccounts),
          type: LedgerEntryType.DEBIT,
          amount: line.bardanaAmount,
          description: bardanaDesc,
        },
        {
          accountId: line.partyAccountId,
          type: LedgerEntryType.CREDIT,
          amount: line.bardanaAmount,
          description: bardanaDesc,
        },
      );
    }
  }

  const feeLegs: Array<{ amount: number; creditAccountId: number; description: string }> = [
    { amount: totals.commissionAmount, creditAccountId: systemAccounts.commission.id, description: 'Commission' },
    { amount: totals.dalaliAmount, creditAccountId: systemAccounts.dalali.id, description: 'Dalali' },
    { amount: totals.sutliAmount, creditAccountId: systemAccounts.sutli.id, description: 'Sutli' },
    { amount: totals.mazduriAmount, creditAccountId: systemAccounts.mazduri.id, description: 'Labour (Mazduri)' },
    { amount: totals.marketFeeAmount, creditAccountId: systemAccounts.marketFee.id, description: 'Market Fee' },
    { amount: totals.munshianaAmount, creditAccountId: systemAccounts.munshiana.id, description: 'Munshiana' },
    { amount: totals.miscAmount, creditAccountId: systemAccounts.misc.id, description: 'Misc' },
  ];

  for (const fee of feeLegs) {
    if (!(fee.amount > 0)) continue;
    legs.push({
      accountId: fee.creditAccountId,
      type: LedgerEntryType.CREDIT,
      amount: fee.amount,
      description: fee.description,
    });
  }

  if (totals.settlementBardanaAmount != null && totals.settlementBardanaAmount > 0) {
    if (!lowerBardanaMode) {
      throw new AppError(400, 'Settlement bardana requires Bori/Thela selection');
    }
    legs.push({
      accountId: bardanaAccountId(lowerBardanaMode, systemAccounts),
      type: LedgerEntryType.CREDIT,
      amount: totals.settlementBardanaAmount,
      description: bardanaDesc,
    });
  }

  legs.push({
    accountId: salePartyAccountId,
    type: LedgerEntryType.DEBIT,
    amount: totals.netSalePartyDebit,
    description: settlementDescription,
  });

  const totalDebits = roundMoney(
    legs.filter((leg) => leg.type === LedgerEntryType.DEBIT).reduce((sum, leg) => sum + leg.amount, 0),
  );
  const totalCredits = roundMoney(
    legs.filter((leg) => leg.type === LedgerEntryType.CREDIT).reduce((sum, leg) => sum + leg.amount, 0),
  );
  const salePartyDebit = roundMoney(
    legs
      .filter((leg) => leg.type === LedgerEntryType.DEBIT && leg.accountId === salePartyAccountId)
      .reduce((sum, leg) => sum + leg.amount, 0),
  );

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new AppError(500, 'Sale Commission voucher debits and credits do not balance');
  }
  if (Math.abs(salePartyDebit - totals.netSalePartyDebit) > 0.01) {
    throw new AppError(500, 'Sale Party debit total does not match net invoice amount');
  }

  const salePartyDebitCount = legs.filter(
    (leg) => leg.type === LedgerEntryType.DEBIT && leg.accountId === salePartyAccountId,
  ).length;
  if (salePartyDebitCount !== 1) {
    throw new AppError(500, 'Sale Commission must post exactly one Sale Party settlement debit');
  }

  return { legs, totalDebits, totalCredits };
}

export async function createSaleCommissionInvoice(data: CreateSaleCommissionInput) {
  if (data.lines.length === 0) {
    throw new AppError(400, 'At least one line is required');
  }

  const prefs = await getSystemPreferences();
  const computedLines = buildComputedLines(data.lines, prefs);
  const totals = computeSaleCommissionInvoiceTotals(computedLines, prefs, {
    munshianaAmount: data.munshianaAmount,
    miscAmount: data.miscAmount,
    lowerBardanaQty: data.lowerBardanaQty,
    lowerBardanaRate: data.lowerBardanaRate,
  });

  if (!(totals.netSalePartyDebit > 0)) {
    throw new AppError(400, 'Invoice net amount must be greater than zero');
  }

  return prisma.$transaction(async (tx) => {
    await getActiveFinancialYearId(tx);
    const systemAccounts = await ensureSaleCommissionAccounts(tx);
    await assertSalePartyAccount(tx, data.salePartyAccountId);
    for (const line of computedLines) {
      await assertPurchasePartyAccount(tx, line.partyAccountId);
    }

    const header: InvoiceVoucherHeader = {
      tafseel: data.tafseel,
      gariNo: data.gariNo,
    };
    const product = data.jins?.trim() || computedLines[0]?.jins?.trim() || null;

    const reference = await nextReference(tx);
    const { legs, totalDebits } = buildLedgerLegs(
      data.salePartyAccountId,
      computedLines,
      totals,
      systemAccounts,
      data.lowerBardanaMode,
      header,
      reference,
      product,
    );

    const financialYearId = await getActiveFinancialYearId(tx);
    const invoiceDate = new Date(data.invoiceDate);

    const invoice = await tx.invoice.create({
      data: {
        type: InvoiceType.SALE_COMMISSION,
        status: InvoiceStatus.POSTED,
        reference,
        invoiceDate,
        billNo: data.billNo?.trim() || null,
        gariNo: data.gariNo?.trim() || null,
        jins: data.jins?.trim() || null,
        qism: data.qism?.trim() || null,
        tafseel: data.tafseel?.trim() || null,
        notes: data.tafseel?.trim() || null,
        debitAccountId: data.salePartyAccountId,
        miscAmount: totals.miscAmount,
        munshianaAmount: totals.munshianaAmount,
        lowerBardanaMode: data.lowerBardanaMode ?? null,
        lowerBardanaQty: data.lowerBardanaQty ?? null,
        lowerBardanaRate: data.lowerBardanaRate ?? null,
        lowerBardanaAmount: totals.settlementBardanaAmount,
        total: totals.netSalePartyDebit,
        financialYearId,
        createdById: data.createdById,
        saleCommissionLines: {
          create: computedLines.map((line, index) => ({
            partyAccountId: line.partyAccountId,
            jins: line.jins?.trim() || null,
            qism: line.qism?.trim() || null,
            boriOrThelaMode: line.boriOrThelaMode,
            bagCount: line.bagCount,
            bhartii: line.bhartii,
            dharanCount: line.dharanCount,
            looseKg: line.looseKg,
            totalWeightKg: line.totalWeightKg,
            ratePerMaund: line.ratePerMaund,
            amount: line.amount,
            bardanaQty: line.bardanaQty ?? null,
            bardanaRate: line.bardanaRate ?? null,
            bardanaAmount: line.bardanaAmount,
            dammiChecked: line.dammiChecked ?? false,
            dammiAmount: line.dammiAmount,
            netCreditToParty: line.netCreditToParty,
            sortOrder: index,
          })),
        },
      },
    });

    const voucher = await createMultiLegVoucherInTx(tx, {
      type: VoucherType.SALE_COMMISSION,
      legs,
      amount: totalDebits,
      date: data.invoiceDate,
      description: `Sale Commission Invoice ${reference}`,
      reference: voucherReferenceFromBillNo(data.billNo),
      createdById: data.createdById,
    });

    await tx.invoiceVoucher.create({
      data: { invoiceId: invoice.id, voucherId: voucher.id },
    });

    return tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: {
        saleCommissionLines: { include: { partyAccount: true }, orderBy: { sortOrder: 'asc' } },
        vouchers: { include: { voucher: { include: { ledgerEntries: true } } } },
        debitAccount: true,
        createdBy: { select: { id: true, displayName: true, username: true } },
      },
    });
  });
}

export async function previewSaleCommissionTotals(data: {
  lines: SaleCommissionLineInput[];
  munshianaAmount?: number;
  miscAmount?: number;
  lowerBardanaQty?: number | null;
  lowerBardanaRate?: number | null;
}) {
  const prefs = await getSystemPreferences();
  const computedLines = buildComputedLines(data.lines, prefs);
  return computeSaleCommissionInvoiceTotals(
    computedLines.map((row) => ({
      amount: row.amount,
      dammiAmount: row.dammiAmount,
      bagCount: row.bagCount,
    })),
    prefs,
    {
      munshianaAmount: data.munshianaAmount,
      miscAmount: data.miscAmount,
      lowerBardanaQty: data.lowerBardanaQty,
      lowerBardanaRate: data.lowerBardanaRate,
    },
  );
}
