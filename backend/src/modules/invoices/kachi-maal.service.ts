import {
  BoriThelaMode,
  InvoiceStatus,
  InvoiceType,
  LedgerEntryType,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  createKachiVoucherInTx,
  ensureKachiMaalAccounts,
  getActiveFinancialYearId,
  KACHI_MAAL_CATEGORY_NAMES,
  type VoucherLeg,
} from '../accounting/accounting.service';
import { getSystemPreferences } from '../preferences/preferences.service';
import {
  computeKachiMaalInvoiceTotals,
  computeKachiMaalRow,
  roundMoney,
} from './kachi-maal.calculations';
import {
  bardanaAgainstInvoiceDescription,
  blendedLegDescription,
  type InvoiceVoucherHeader,
  voucherReferenceFromBillNo,
} from './invoice-voucher-descriptions';

const TYPE_PREFIX = 'KM';

async function nextReference(tx: Prisma.TransactionClient) {
  const count = await tx.invoice.count({ where: { type: InvoiceType.KACHI_MAAL } });
  return `${TYPE_PREFIX}-${String(count + 1).padStart(5, '0')}`;
}

export async function getNextKachiMaalReference() {
  return prisma.$transaction(async (tx) => {
    await ensureKachiMaalAccounts(tx);
    return { reference: await nextReference(tx) };
  });
}

export type KachiMaalLineInput = {
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
};

export type CreateKachiMaalInput = {
  invoiceDate: string;
  billNo?: string;
  gariNo?: string;
  jins?: string;
  qism?: string;
  tafseel?: string;
  debitAccountId: number;
  miscAmount?: number;
  lowerBardanaMode?: BoriThelaMode | null;
  lowerBardanaQty?: number | null;
  lowerBardanaRate?: number | null;
  lines: KachiMaalLineInput[];
  createdById: number;
};

function bardanaAccountId(
  mode: BoriThelaMode,
  accounts: Awaited<ReturnType<typeof ensureKachiMaalAccounts>>,
) {
  return mode === BoriThelaMode.BORI ? accounts.bori.id : accounts.thela.id;
}

async function assertPurchasePartyAccount(tx: Prisma.TransactionClient, accountId: number) {
  const account = await tx.account.findFirst({
    where: { id: accountId, isActive: true },
    include: { category: true },
  });
  if (!account) throw new AppError(400, 'Invalid purchase party account');
  if (account.category.name !== KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY) {
    throw new AppError(400, 'Party must be a Purchase Party account');
  }
  return account;
}

async function assertDebitAccount(tx: Prisma.TransactionClient, accountId: number) {
  const account = await tx.account.findFirst({
    where: { id: accountId, isActive: true },
    include: { category: true },
  });
  if (!account) throw new AppError(400, 'Invalid debit account');
  const allowed = new Set<string>([
    KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY,
    KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
  ]);
  if (!allowed.has(account.category.name)) {
    throw new AppError(400, 'Debit account must be a Purchase Party or Sale Party account');
  }
  return account;
}

type ComputedLine = KachiMaalLineInput & {
  totalWeightKg: number;
  amount: number;
  bardanaAmount: number | null;
  paleDari: number;
  brokery: number;
  netCreditToParty: number;
};

function buildComputedLines(
  lines: KachiMaalLineInput[],
  prefs: { paleDariPercent: number; brokeryPercent: number },
): ComputedLine[] {
  return lines.map((line) => {
    const computed = computeKachiMaalRow(line, prefs);
    if (!(computed.amount > 0)) {
      throw new AppError(400, 'Each line must have a positive goods amount');
    }
    if (!(line.bhartii > 0)) {
      throw new AppError(400, 'Bhartii must be greater than zero on every line');
    }
    return { ...line, ...computed };
  });
}

function buildLedgerLegs(
  debitAccountId: number,
  computedLines: ComputedLine[],
  totals: ReturnType<typeof computeKachiMaalInvoiceTotals>,
  systemAccounts: Awaited<ReturnType<typeof ensureKachiMaalAccounts>>,
  lowerBardanaMode: BoriThelaMode | null | undefined,
  header: InvoiceVoucherHeader,
  invoiceReference: string,
) {
  const legs: VoucherLeg[] = [];
  const allLines = computedLines;
  const bardanaDesc = bardanaAgainstInvoiceDescription(invoiceReference);

  legs.push({
    accountId: debitAccountId,
    type: LedgerEntryType.DEBIT,
    amount: totals.totalDebitAmount,
    description: blendedLegDescription(allLines, header),
  });

  const partyNetByAccount = new Map<number, number>();
  for (const line of computedLines) {
    const net = roundMoney(line.amount - line.paleDari - line.brokery);
    const current = partyNetByAccount.get(line.partyAccountId) ?? 0;
    partyNetByAccount.set(line.partyAccountId, roundMoney(current + net));
  }

  for (const [partyAccountId, netAmount] of partyNetByAccount) {
    if (netAmount <= 0) {
      throw new AppError(500, 'Party net settlement must be positive');
    }
    legs.push({
      accountId: partyAccountId,
      type: LedgerEntryType.CREDIT,
      amount: netAmount,
      description: blendedLegDescription(
        allLines.filter((line) => line.partyAccountId === partyAccountId),
        header,
      ),
    });
  }

  for (let i = 0; i < computedLines.length; i += 1) {
    const line = computedLines[i]!;
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

  if (totals.lowerBardanaAmount != null && totals.lowerBardanaAmount > 0) {
    if (!lowerBardanaMode) {
      throw new AppError(400, 'Lower bardana requires Bori/Thela selection');
    }
    legs.push(
      {
        accountId: debitAccountId,
        type: LedgerEntryType.DEBIT,
        amount: totals.lowerBardanaAmount,
        description: bardanaDesc,
      },
      {
        accountId: bardanaAccountId(lowerBardanaMode, systemAccounts),
        type: LedgerEntryType.CREDIT,
        amount: totals.lowerBardanaAmount,
        description: bardanaDesc,
      },
    );
  }

  if (totals.totalPaleDari > 0) {
    legs.push({
      accountId: systemAccounts.mazduri.id,
      type: LedgerEntryType.CREDIT,
      amount: totals.totalPaleDari,
      description: blendedLegDescription(allLines, header),
    });
  }

  if (totals.totalBrokery > 0) {
    legs.push({
      accountId: systemAccounts.broker.id,
      type: LedgerEntryType.CREDIT,
      amount: totals.totalBrokery,
      description: blendedLegDescription(allLines, header),
    });
  }

  if (totals.marketFeeAmount > 0) {
    legs.push({
      accountId: systemAccounts.marketFee.id,
      type: LedgerEntryType.CREDIT,
      amount: totals.marketFeeAmount,
      description: blendedLegDescription(allLines, header),
    });
  }

  const miscAmount = roundMoney(
    totals.totalDebitAmount
      - totals.totalGoodsAmount
      - totals.marketFeeAmount
      - totals.profitAmount,
  );

  if (miscAmount > 0) {
    legs.push({
      accountId: systemAccounts.misc.id,
      type: LedgerEntryType.CREDIT,
      amount: miscAmount,
      description: blendedLegDescription(allLines, header),
    });
  }

  if (totals.profitAmount > 0) {
    legs.push({
      accountId: systemAccounts.commission.id,
      type: LedgerEntryType.CREDIT,
      amount: totals.profitAmount,
      description: blendedLegDescription(allLines, header),
    });
  }

  const totalDebits = roundMoney(
    legs
      .filter((leg) => leg.type === LedgerEntryType.DEBIT)
      .reduce((sum, leg) => sum + leg.amount, 0),
  );
  const totalCredits = roundMoney(
    legs
      .filter((leg) => leg.type === LedgerEntryType.CREDIT)
      .reduce((sum, leg) => sum + leg.amount, 0),
  );

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new AppError(500, 'Merged Kachi Maal legs do not balance');
  }

  return { legs, totalDebits, totalCredits, miscAmount };
}

async function postKachiMaalAccounting(
  tx: Prisma.TransactionClient,
  args: {
    invoiceId: number;
    reference: string;
    invoiceDate: Date | string;
    billNo?: string | null;
    createdById: number;
    legs: VoucherLeg[];
    totalDebits: number;
  },
) {
  const voucher = await createKachiVoucherInTx(tx, {
    legs: args.legs,
    amount: args.totalDebits,
    date: args.invoiceDate,
    description: `Kachi Maal Invoice ${args.reference}`,
    reference: voucherReferenceFromBillNo(args.billNo ?? undefined),
    createdById: args.createdById,
  });

  await tx.invoiceVoucher.create({
    data: { invoiceId: args.invoiceId, voucherId: voucher.id },
  });
}

export async function createKachiMaalInvoice(
  data: CreateKachiMaalInput,
  opts?: { postImmediately?: boolean },
) {
  const postImmediately = opts?.postImmediately !== false;
  if (data.lines.length === 0) {
    throw new AppError(400, 'At least one line is required');
  }

  const prefs = await getSystemPreferences();
  const computedLines = buildComputedLines(data.lines, prefs);
  const totals = computeKachiMaalInvoiceTotals(
    computedLines,
    prefs,
    data.miscAmount ?? 0,
    data.lowerBardanaQty,
    data.lowerBardanaRate,
  );

  return prisma.$transaction(async (tx) => {
    await getActiveFinancialYearId(tx);
    const systemAccounts = await ensureKachiMaalAccounts(tx);
    await assertDebitAccount(tx, data.debitAccountId);
    for (const line of computedLines) {
      await assertPurchasePartyAccount(tx, line.partyAccountId);
    }

    const voucherHeader: InvoiceVoucherHeader = {
      tafseel: data.tafseel,
      gariNo: data.gariNo,
    };

    const reference = await nextReference(tx);
    const { legs, totalDebits, totalCredits, miscAmount } = buildLedgerLegs(
      data.debitAccountId,
      computedLines,
      totals,
      systemAccounts,
      data.lowerBardanaMode,
      voucherHeader,
      reference,
    );

    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      throw new AppError(500, 'Invoice debits and credits do not balance — save aborted');
    }

    const financialYearId = await getActiveFinancialYearId(tx);
    const invoiceDate = new Date(data.invoiceDate);

    const invoice = await tx.invoice.create({
      data: {
        type: InvoiceType.KACHI_MAAL,
        status: postImmediately ? InvoiceStatus.POSTED : InvoiceStatus.PENDING_APPROVAL,
        reference,
        invoiceDate,
        billNo: data.billNo?.trim() || null,
        gariNo: data.gariNo?.trim() || null,
        jins: data.jins?.trim() || null,
        qism: data.qism?.trim() || null,
        tafseel: data.tafseel?.trim() || null,
        notes: data.tafseel?.trim() || null,
        debitAccountId: data.debitAccountId,
        miscAmount,
        lowerBardanaMode: data.lowerBardanaMode ?? null,
        lowerBardanaQty: data.lowerBardanaQty ?? null,
        lowerBardanaRate: data.lowerBardanaRate ?? null,
        lowerBardanaAmount: totals.lowerBardanaAmount,
        total: totals.totalDebitAmount,
        financialYearId,
        createdById: data.createdById,
        kachiMaalLines: {
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
            netCreditToParty: line.netCreditToParty,
            sortOrder: index,
          })),
        },
      },
    });

    if (postImmediately) {
      await postKachiMaalAccounting(tx, {
        invoiceId: invoice.id,
        reference,
        invoiceDate: data.invoiceDate,
        billNo: data.billNo,
        createdById: data.createdById,
        legs,
        totalDebits,
      });
    }

    return tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: {
        kachiMaalLines: { include: { partyAccount: true }, orderBy: { sortOrder: 'asc' } },
        vouchers: { include: { voucher: { include: { ledgerEntries: true } } } },
        debitAccount: true,
        createdBy: { select: { id: true, displayName: true, username: true } },
      },
    });
  });
}

export async function approveKachiMaalInvoice(invoiceId: number) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: {
        id: invoiceId,
        type: InvoiceType.KACHI_MAAL,
        status: InvoiceStatus.PENDING_APPROVAL,
      },
      include: { kachiMaalLines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!invoice) throw new AppError(404, 'Pending kachi maal invoice not found');
    if (invoice.debitAccountId == null) {
      throw new AppError(400, 'Kachi maal invoice missing debit account');
    }

    const prefs = await getSystemPreferences();
    const systemAccounts = await ensureKachiMaalAccounts(tx);
    await assertDebitAccount(tx, invoice.debitAccountId);

    const computedLines: ComputedLine[] = invoice.kachiMaalLines.map((line) => {
      const input = {
        partyAccountId: line.partyAccountId,
        jins: line.jins ?? undefined,
        qism: line.qism ?? undefined,
        boriOrThelaMode: line.boriOrThelaMode,
        bagCount: Number(line.bagCount),
        bhartii: Number(line.bhartii),
        dharanCount: Number(line.dharanCount),
        looseKg: Number(line.looseKg),
        ratePerMaund: Number(line.ratePerMaund),
        bardanaQty: line.bardanaQty != null ? Number(line.bardanaQty) : null,
        bardanaRate: line.bardanaRate != null ? Number(line.bardanaRate) : null,
      };
      const computed = computeKachiMaalRow(input, prefs);
      return { ...input, ...computed };
    });

    for (const line of computedLines) {
      await assertPurchasePartyAccount(tx, line.partyAccountId);
    }

    const totals = computeKachiMaalInvoiceTotals(
      computedLines,
      prefs,
      invoice.miscAmount != null ? Number(invoice.miscAmount) : 0,
      invoice.lowerBardanaQty != null ? Number(invoice.lowerBardanaQty) : null,
      invoice.lowerBardanaRate != null ? Number(invoice.lowerBardanaRate) : null,
    );

    const voucherHeader: InvoiceVoucherHeader = {
      tafseel: invoice.tafseel,
      gariNo: invoice.gariNo,
    };
    const { legs, totalDebits, totalCredits } = buildLedgerLegs(
      invoice.debitAccountId,
      computedLines,
      totals,
      systemAccounts,
      invoice.lowerBardanaMode,
      voucherHeader,
      invoice.reference,
    );
    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      throw new AppError(500, 'Invoice debits and credits do not balance — approve aborted');
    }

    await postKachiMaalAccounting(tx, {
      invoiceId: invoice.id,
      reference: invoice.reference,
      invoiceDate: invoice.invoiceDate ?? new Date(),
      billNo: invoice.billNo,
      createdById: invoice.createdById,
      legs,
      totalDebits,
    });

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.POSTED },
    });

    return tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: {
        kachiMaalLines: { include: { partyAccount: true }, orderBy: { sortOrder: 'asc' } },
        vouchers: { include: { voucher: { include: { ledgerEntries: true } } } },
        debitAccount: true,
        createdBy: { select: { id: true, displayName: true, username: true } },
      },
    });
  });
}

export async function previewKachiMaalTotals(data: {
  lines: KachiMaalLineInput[];
  miscAmount?: number;
  lowerBardanaQty?: number | null;
  lowerBardanaRate?: number | null;
}) {
  const prefs = await getSystemPreferences();
  const computedLines = data.lines.map((line) => ({
    ...computeKachiMaalRow(line, prefs),
    bhartii: line.bhartii,
    bardanaAmount: computeKachiMaalRow(line, prefs).bardanaAmount,
  }));
  return computeKachiMaalInvoiceTotals(
    computedLines,
    prefs,
    data.miscAmount ?? 0,
    data.lowerBardanaQty,
    data.lowerBardanaRate,
  );
}
