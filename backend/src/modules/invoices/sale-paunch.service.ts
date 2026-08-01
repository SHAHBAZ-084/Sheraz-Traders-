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
  createSalePaunchVoucherInTx,
  ensureSalePaunchAccounts,
  getActiveFinancialYearId,
  KACHI_MAAL_CATEGORY_NAMES,
  type SalePaunchSystemAccounts,
  type VoucherLeg,
} from '../accounting/accounting.service';
import { assertMaalKhataAccount } from '../products/maal-khata';
import { getSystemPreferences } from '../preferences/preferences.service';
import {
  bardanaAgainstInvoiceDescription,
  blendedLegDescription,
  invoiceVoucherHeaderSuffix,
  type InvoiceVoucherHeader,
  voucherReferenceFromBillNo,
} from './invoice-voucher-descriptions';
import {
  computeSalePaunchInvoiceTotals,
  computeSalePaunchRow,
  roundMoney,
} from './sale-paunch.calculations';
import { postSalePaunchEmptyBardanaOut } from '../inventory/bardana.service';
import { postSalePaunchStockOut } from '../stock/stock.service';

const TYPE_PREFIX = 'SP';

async function nextReference(tx: Prisma.TransactionClient) {
  const count = await tx.invoice.count({ where: { type: InvoiceType.SALE_PAUNCH } });
  return `${TYPE_PREFIX}-${String(count + 1).padStart(5, '0')}`;
}

export async function getNextSalePaunchReference() {
  return prisma.$transaction(async (tx) => {
    await ensureSalePaunchAccounts(tx);
    return { reference: await nextReference(tx) };
  });
}

export type SalePaunchLineInput = {
  maalKhataAccountId: number;
  jins?: string;
  qism?: string;
  boriOrThelaMode: BoriThelaMode;
  bagCount: number;
  thelaCount?: number;
  /** Computer weight in kg — primary weight input. */
  compWeightKg: number;
  kaatKg?: number;
  lowerKaatKg?: number;
  upperRatePerMaund: number;
  lowerRatePerMaund: number;
  kanta?: number;
  bardanaQty?: number | null;
  bardanaRate?: number | null;
  dammiChecked?: boolean;
};

export type CreateSalePaunchInput = {
  invoiceDate: string;
  salePartyAccountId: number;
  billNo?: string;
  gariNo?: string;
  jins?: string;
  qism?: string;
  tafseel?: string;
  taxAmount?: number;
  biltyKirayaAmount?: number;
  miscAmount?: number;
  lowerBardanaMode?: BoriThelaMode | null;
  lowerBardanaQty?: number | null;
  lowerBardanaRate?: number | null;
  lines: SalePaunchLineInput[];
  createdById: number;
};

function bardanaAccountId(
  mode: BoriThelaMode,
  accounts: SalePaunchSystemAccounts,
) {
  return mode === BoriThelaMode.BORI ? accounts.bori.id : accounts.thela.id;
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

type ComputedLine = SalePaunchLineInput & ReturnType<typeof computeSalePaunchRow>;

function toVoucherLine(line: ComputedLine) {
  return {
    totalWeightKg: line.totalWeightKg,
    ratePerMaund: line.upperRatePerMaund,
    kanta: line.kanta,
    upperRatePerMaund: line.upperRatePerMaund,
    lowerRatePerMaund: line.lowerRatePerMaund,
  };
}

function toVoucherLines(lines: ComputedLine[]) {
  return lines.map((line) => ({
    totalWeightKg: line.totalWeightKg,
    ratePerMaund: line.upperRatePerMaund,
  }));
}

function buildComputedLines(
  lines: SalePaunchLineInput[],
  prefs: { daamiPercent: number },
): ComputedLine[] {
  return lines.map((line) => {
    const computed = computeSalePaunchRow(line, prefs);
    if (!(line.compWeightKg > 0)) {
      throw new AppError(400, 'Computer weight must be greater than zero on every line');
    }
    if (computed.kaatKg > computed.totalWeightKg) {
      throw new AppError(400, 'Upper kaat cannot exceed computer weight on any row');
    }
    if (computed.lowerKaatKg > computed.totalWeightKg) {
      throw new AppError(400, 'Lower kaat cannot exceed computer weight on any row');
    }
    if (!(computed.netUpperAmount > 0)) {
      throw new AppError(400, 'Each line must have a positive net upper amount after kanta');
    }
    if (!(computed.netWeightKg > 0)) {
      throw new AppError(400, 'Each line must have positive net weight after upper kaat');
    }
    if (!(computed.lowerNetWeightKg > 0)) {
      throw new AppError(400, 'Each line must have positive net weight after lower kaat');
    }
    if (!(computed.lowerAmount > 0)) {
      throw new AppError(400, 'Each line must have a positive lower sale amount');
    }
    return {
      ...line,
      ...computed,
      thelaCount: line.thelaCount ?? 0,
      dammiChecked: line.dammiChecked ?? false,
    };
  });
}

function buildLedgerLegs(
  salePartyAccountId: number,
  computedLines: ComputedLine[],
  totals: ReturnType<typeof computeSalePaunchInvoiceTotals>,
  systemAccounts: SalePaunchSystemAccounts,
  lowerBardanaMode: BoriThelaMode | null | undefined,
  header: InvoiceVoucherHeader,
  taxAmount: number,
  biltyKirayaAmount: number,
  miscAmount: number,
  invoiceReference: string,
) {
  const legs: VoucherLeg[] = [];
  const allLines = computedLines;
  const bardanaDesc = bardanaAgainstInvoiceDescription(invoiceReference);

  const maalKhataByAccount = new Map<number, number>();
  for (const line of computedLines) {
    const current = maalKhataByAccount.get(line.maalKhataAccountId) ?? 0;
    maalKhataByAccount.set(
      line.maalKhataAccountId,
      roundMoney(current + line.netUpperAmount),
    );
  }

  for (const [accountId, amount] of maalKhataByAccount) {
    const rowLines = allLines.filter((line) => line.maalKhataAccountId === accountId);
    legs.push({
      accountId,
      type: LedgerEntryType.CREDIT,
      amount,
      description: blendedLegDescription(
        rowLines.map((line) => ({
          totalWeightKg: line.totalWeightKg,
          ratePerMaund: line.upperRatePerMaund,
        })),
        header,
      ),
    });
  }

  if (totals.totalDammiAmount > 0) {
    legs.push({
      accountId: systemAccounts.commission.id,
      type: LedgerEntryType.CREDIT,
      amount: totals.totalDammiAmount,
      description: blendedLegDescription(toVoucherLines(allLines), header),
    });
  }

  for (const line of computedLines) {
    if (line.bardanaAmount != null && line.bardanaAmount > 0) {
      legs.push(
        {
          accountId: salePartyAccountId,
          type: LedgerEntryType.DEBIT,
          amount: line.bardanaAmount,
          description: bardanaDesc,
        },
        {
          accountId: bardanaAccountId(line.boriOrThelaMode, systemAccounts),
          type: LedgerEntryType.CREDIT,
          amount: line.bardanaAmount,
          description: bardanaDesc,
        },
      );
    }
  }

  if (totals.lowerBardanaAmount != null && totals.lowerBardanaAmount > 0) {
    if (!lowerBardanaMode) {
      throw new AppError(400, 'Lower bardana requires Bori/Thela selection');
    }
    legs.push(
      {
        accountId: bardanaAccountId(lowerBardanaMode, systemAccounts),
        type: LedgerEntryType.DEBIT,
        amount: totals.lowerBardanaAmount,
        description: bardanaDesc,
      },
      {
        accountId: salePartyAccountId,
        type: LedgerEntryType.CREDIT,
        amount: totals.lowerBardanaAmount,
        description: bardanaDesc,
      },
    );
  }

  if (taxAmount > 0) {
    legs.push(
      {
        accountId: systemAccounts.taxDeduction.id,
        type: LedgerEntryType.DEBIT,
        amount: taxAmount,
        description: `Tax${invoiceVoucherHeaderSuffix(header)}`,
      },
      {
        accountId: salePartyAccountId,
        type: LedgerEntryType.CREDIT,
        amount: taxAmount,
        description: `Tax${invoiceVoucherHeaderSuffix(header)}`,
      },
    );
  }

  if (biltyKirayaAmount > 0) {
    legs.push(
      {
        accountId: systemAccounts.biltyKiraya.id,
        type: LedgerEntryType.DEBIT,
        amount: biltyKirayaAmount,
        description: `Bilty Kiraya${invoiceVoucherHeaderSuffix(header)}`,
      },
      {
        accountId: salePartyAccountId,
        type: LedgerEntryType.CREDIT,
        amount: biltyKirayaAmount,
        description: `Bilty Kiraya${invoiceVoucherHeaderSuffix(header)}`,
      },
    );
  }

  if (miscAmount > 0) {
    legs.push({
      accountId: systemAccounts.misc.id,
      type: LedgerEntryType.CREDIT,
      amount: miscAmount,
      description: `Misc${invoiceVoucherHeaderSuffix(header)}`,
    });
  }

  if (totals.lowerNetTotal > 0) {
    legs.push({
      accountId: salePartyAccountId,
      type: LedgerEntryType.DEBIT,
      amount: totals.lowerNetTotal,
      description: blendedLegDescription(toVoucherLines(allLines), header),
    });
  }

  const revenueDiff = totals.paunchRevenueDifference;
  if (Math.abs(revenueDiff) > 0) {
    // Spec: Dr Paunch Revenue when lowerNetTotal > upperNetTotal (profitable).
    // Standard REVENUE accounts increase on CREDIT — we post CREDIT here so the
    // voucher balances; confirm trial-balance display convention for "Revenue Earn".
    legs.push({
      accountId: systemAccounts.paunchRevenue.id,
      type: revenueDiff > 0 ? LedgerEntryType.CREDIT : LedgerEntryType.DEBIT,
      amount: Math.abs(revenueDiff),
      description: `Paunch revenue plug${invoiceVoucherHeaderSuffix(header)}`,
    });
  }

  const totalDebits = roundMoney(
    legs.filter((leg) => leg.type === LedgerEntryType.DEBIT).reduce((sum, leg) => sum + leg.amount, 0),
  );
  const totalCredits = roundMoney(
    legs.filter((leg) => leg.type === LedgerEntryType.CREDIT).reduce((sum, leg) => sum + leg.amount, 0),
  );

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new AppError(500, 'Sale Paunch voucher debits and credits do not balance');
  }

  return { legs, totalDebits, totalCredits };
}

export async function createSalePaunchInvoice(data: CreateSalePaunchInput) {
  if (data.lines.length === 0) {
    throw new AppError(400, 'At least one line is required');
  }

  const prefs = await getSystemPreferences();
  const computedLines = buildComputedLines(data.lines, prefs);
  const taxAmount = roundMoney(Math.max(0, data.taxAmount ?? 0));
  const biltyKirayaAmount = roundMoney(Math.max(0, data.biltyKirayaAmount ?? 0));
  const miscAmount = roundMoney(Math.max(0, data.miscAmount ?? 0));
  const totals = computeSalePaunchInvoiceTotals(computedLines, {
    taxAmount,
    biltyKirayaAmount,
    miscAmount,
    lowerBardanaQty: data.lowerBardanaQty,
    lowerBardanaRate: data.lowerBardanaRate,
  });

  return prisma.$transaction(async (tx) => {
    await getActiveFinancialYearId(tx);
    const systemAccounts = await ensureSalePaunchAccounts(tx);
    await assertSalePartyAccount(tx, data.salePartyAccountId);
    for (const line of computedLines) {
      await assertMaalKhataAccount(tx, line.maalKhataAccountId);
    }

    const voucherHeader: InvoiceVoucherHeader = {
      tafseel: data.tafseel,
      gariNo: data.gariNo,
    };

    const reference = await nextReference(tx);
    const { legs, totalDebits, totalCredits } = buildLedgerLegs(
      data.salePartyAccountId,
      computedLines,
      totals,
      systemAccounts,
      data.lowerBardanaMode,
      voucherHeader,
      taxAmount,
      biltyKirayaAmount,
      miscAmount,
      reference,
    );

    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      throw new AppError(500, 'Invoice debits and credits do not balance — save aborted');
    }

    const financialYearId = await getActiveFinancialYearId(tx);
    const invoiceDate = new Date(data.invoiceDate);

    const invoice = await tx.invoice.create({
      data: {
        type: InvoiceType.SALE_PAUNCH,
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
        miscAmount,
        taxAmount,
        biltyKirayaAmount,
        lowerBardanaMode: data.lowerBardanaMode ?? null,
        lowerBardanaQty: data.lowerBardanaQty ?? null,
        lowerBardanaRate: data.lowerBardanaRate ?? null,
        lowerBardanaAmount: totals.lowerBardanaAmount,
        total: totals.lowerNetTotal,
        financialYearId,
        createdById: data.createdById,
        salePaunchLines: {
          create: computedLines.map((line, index) => ({
            maalKhataAccountId: line.maalKhataAccountId,
            jins: line.jins?.trim() || null,
            qism: line.qism?.trim() || null,
            boriOrThelaMode: line.boriOrThelaMode,
            bagCount: line.bagCount,
            thelaCount: line.thelaCount ?? 0,
            bhartii: 0,
            dharanCount: 0,
            looseKg: 0,
            totalWeightKg: line.totalWeightKg,
            kaatKg: line.kaatKg,
            netWeightKg: line.netWeightKg,
            lowerKaatKg: line.lowerKaatKg,
            lowerNetWeightKg: line.lowerNetWeightKg,
            upperRatePerMaund: line.upperRatePerMaund,
            upperAmount: line.upperAmount,
            kanta: line.kanta,
            netUpperAmount: line.netUpperAmount,
            lowerRatePerMaund: line.lowerRatePerMaund,
            lowerAmount: line.lowerAmount,
            rowRevenue: line.rowRevenue,
            bardanaQty: line.bardanaQty ?? null,
            bardanaRate: line.bardanaRate ?? null,
            bardanaAmount: line.bardanaAmount,
            dammiChecked: line.dammiChecked ?? false,
            dammiAmount: line.dammiAmount,
            sortOrder: index,
          })),
        },
      },
    });

    const voucher = await createSalePaunchVoucherInTx(tx, {
      legs,
      amount: totalDebits,
      date: data.invoiceDate,
      description: `Sale Paunch Invoice ${reference}`,
      reference: voucherReferenceFromBillNo(data.billNo),
      createdById: data.createdById,
    });

    await tx.invoiceVoucher.create({
      data: { invoiceId: invoice.id, voucherId: voucher.id },
    });

    await postSalePaunchStockOut(tx, {
      invoiceId: invoice.id,
      invoiceReference: reference,
      invoiceDate,
      lines: computedLines.map((line) => ({
        maalKhataAccountId: line.maalKhataAccountId,
        boriOrThelaMode: line.boriOrThelaMode,
        bagCount: line.bagCount,
        thelaCount: line.thelaCount ?? 0,
      })),
    });

    await postSalePaunchEmptyBardanaOut(tx, {
      invoiceId: invoice.id,
      invoiceReference: reference,
      invoiceDate,
      lines: computedLines.map((line) => ({
        boriOrThelaMode: line.boriOrThelaMode,
        bagCount: line.bagCount,
        thelaCount: line.thelaCount ?? 0,
      })),
    });

    return tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: {
        salePaunchLines: { include: { maalKhataAccount: true }, orderBy: { sortOrder: 'asc' } },
        vouchers: { include: { voucher: { include: { ledgerEntries: true } } } },
        debitAccount: true,
        createdBy: { select: { id: true, displayName: true, username: true } },
      },
    });
  });
}

export async function previewSalePaunchTotals(data: {
  lines: SalePaunchLineInput[];
  taxAmount?: number;
  biltyKirayaAmount?: number;
  miscAmount?: number;
  lowerBardanaQty?: number | null;
  lowerBardanaRate?: number | null;
}) {
  const prefs = await getSystemPreferences();
  const computedLines = data.lines.map((line) => computeSalePaunchRow(line, prefs));
  return computeSalePaunchInvoiceTotals(computedLines, {
    taxAmount: data.taxAmount,
    biltyKirayaAmount: data.biltyKirayaAmount,
    miscAmount: data.miscAmount,
    lowerBardanaQty: data.lowerBardanaQty,
    lowerBardanaRate: data.lowerBardanaRate,
  });
}
