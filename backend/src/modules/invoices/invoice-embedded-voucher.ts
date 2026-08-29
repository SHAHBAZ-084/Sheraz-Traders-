import { LedgerEntryType, Prisma, VoucherStatus, VoucherType } from '@prisma/client';
import { AppError } from '../../utils/helpers';
import { createVoucherInTx, type VoucherLeg } from '../accounting/accounting.service';
import { roundMoney } from './sale-invoice.calculations';

function isBankOrCashCategory(name: string) {
  const n = name.trim().toLowerCase();
  return n.includes('bank') || n.includes('cash');
}

export type EmbeddedReceiptLineInput = {
  amount: number;
  accountId: number;
};

export type EmbeddedPaymentLineInput = {
  amount: number;
  accountId: number;
};

/** @deprecated Use EmbeddedReceiptLineInput */
export type EmbeddedReceiptInput = EmbeddedReceiptLineInput;

/** @deprecated Use EmbeddedPaymentLineInput */
export type EmbeddedPaymentInput = EmbeddedPaymentLineInput;

export type EmbeddedReceiptLinesPayload = {
  receipts?: Array<{ amount?: number; accountId?: number }>;
  receiptAmount?: number;
  receiptAccountId?: number;
};

export type EmbeddedPaymentLinesPayload = {
  payments?: Array<{ amount?: number; accountId?: number }>;
  paymentAmount?: number;
  paymentAccountId?: number;
};

function normalizeReceiptLinesPayload(payload: EmbeddedReceiptLinesPayload) {
  if (payload.receipts != null && payload.receipts.length > 0) {
    return payload.receipts;
  }
  if (payload.receiptAmount != null || payload.receiptAccountId != null) {
    return [{ amount: payload.receiptAmount, accountId: payload.receiptAccountId }];
  }
  return [];
}

function normalizePaymentLinesPayload(payload: EmbeddedPaymentLinesPayload) {
  if (payload.payments != null && payload.payments.length > 0) {
    return payload.payments;
  }
  if (payload.paymentAmount != null || payload.paymentAccountId != null) {
    return [{ amount: payload.paymentAmount, accountId: payload.paymentAccountId }];
  }
  return [];
}

export function parseEmbeddedReceiptLinesInput(
  payload: EmbeddedReceiptLinesPayload,
  invoiceTotal: number,
): EmbeddedReceiptLineInput[] {
  const rawLines = normalizeReceiptLinesPayload(payload);
  if (rawLines.length === 0) return [];

  const parsed: EmbeddedReceiptLineInput[] = [];
  for (const line of rawLines) {
    const amount = line.amount != null ? roundMoney(line.amount) : 0;
    if (amount <= 0) {
      if (line.accountId != null) {
        throw new AppError(400, 'Receipt amount is required when a receipt account is selected');
      }
      continue;
    }
    if (line.accountId == null) {
      throw new AppError(400, 'Receipt account is required when receipt amount is greater than zero');
    }
    parsed.push({ amount, accountId: line.accountId });
  }

  if (parsed.length === 0) return [];

  const sum = roundMoney(parsed.reduce((total, line) => total + line.amount, 0));
  if (sum > invoiceTotal + 0.01) {
    throw new AppError(400, 'Total receipt amount cannot exceed invoice total');
  }
  return parsed;
}

export function parseEmbeddedPaymentLinesInput(
  payload: EmbeddedPaymentLinesPayload,
  invoiceTotal: number,
): EmbeddedPaymentLineInput[] {
  const rawLines = normalizePaymentLinesPayload(payload);
  if (rawLines.length === 0) return [];

  const parsed: EmbeddedPaymentLineInput[] = [];
  for (const line of rawLines) {
    const amount = line.amount != null ? roundMoney(line.amount) : 0;
    if (amount <= 0) {
      if (line.accountId != null) {
        throw new AppError(400, 'Payment amount is required when a payment account is selected');
      }
      continue;
    }
    if (line.accountId == null) {
      throw new AppError(400, 'Payment account is required when payment amount is greater than zero');
    }
    parsed.push({ amount, accountId: line.accountId });
  }

  if (parsed.length === 0) return [];

  const sum = roundMoney(parsed.reduce((total, line) => total + line.amount, 0));
  if (sum > invoiceTotal + 0.01) {
    throw new AppError(400, 'Total payment amount cannot exceed invoice total');
  }
  return parsed;
}

export function parseEmbeddedReceiptInput(
  receiptAmount: number | undefined,
  receiptAccountId: number | undefined,
  invoiceTotal: number,
): EmbeddedReceiptLineInput | null {
  const lines = parseEmbeddedReceiptLinesInput({ receiptAmount, receiptAccountId }, invoiceTotal);
  if (lines.length === 0) return null;
  if (lines.length > 1) {
    throw new AppError(400, 'Multiple receipt lines require the receipts array');
  }
  return lines[0];
}

export function parseEmbeddedPaymentInput(
  paymentAmount: number | undefined,
  paymentAccountId: number | undefined,
  invoiceTotal: number,
): EmbeddedPaymentLineInput | null {
  const lines = parseEmbeddedPaymentLinesInput({ paymentAmount, paymentAccountId }, invoiceTotal);
  if (lines.length === 0) return null;
  if (lines.length > 1) {
    throw new AppError(400, 'Multiple payment lines require the payments array');
  }
  return lines[0];
}

export function parseStoredEmbeddedLines(raw: unknown): Array<{ amount: number; accountId: number }> {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const out: Array<{ amount: number; accountId: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { amount?: unknown; accountId?: unknown };
    const amount = Number(row.amount);
    const accountId = Number(row.accountId);
    if (!(amount > 0) || !Number.isFinite(amount) || !(accountId > 0) || !Number.isFinite(accountId)) {
      continue;
    }
    out.push({ amount: roundMoney(amount), accountId });
  }
  return out;
}

export function embeddedReceiptScalarFields(receipts: EmbeddedReceiptLineInput[]) {
  if (receipts.length === 0) {
    return {
      embeddedReceiptAmount: null as number | null,
      embeddedReceiptAccountId: null as number | null,
      embeddedReceiptLines: Prisma.JsonNull,
    };
  }
  const sum = roundMoney(receipts.reduce((total, line) => total + line.amount, 0));
  return {
    embeddedReceiptAmount: sum,
    embeddedReceiptAccountId: receipts[0].accountId,
    embeddedReceiptLines: receipts.map((line) => ({
      amount: line.amount,
      accountId: line.accountId,
    })),
  };
}

export function embeddedPaymentScalarFields(payments: EmbeddedPaymentLineInput[]) {
  if (payments.length === 0) {
    return {
      embeddedPaymentAmount: null as number | null,
      embeddedPaymentAccountId: null as number | null,
      embeddedPaymentLines: Prisma.JsonNull,
    };
  }
  const sum = roundMoney(payments.reduce((total, line) => total + line.amount, 0));
  return {
    embeddedPaymentAmount: sum,
    embeddedPaymentAccountId: payments[0].accountId,
    embeddedPaymentLines: payments.map((line) => ({
      amount: line.amount,
      accountId: line.accountId,
    })),
  };
}

async function assertBankOrCashAccount(
  tx: Prisma.TransactionClient,
  accountId: number,
  label: string,
) {
  const account = await tx.account.findFirst({
    where: { id: accountId, isActive: true },
    include: { category: true },
  });
  if (!account) throw new AppError(400, `${label} account is invalid`);
  if (!isBankOrCashCategory(account.category.name)) {
    throw new AppError(400, `${label} account must be a Bank or Cash account`);
  }
  return account;
}

/** Delete leftover pending SALE_RECEIPT / PURCHASE_PAYMENT vouchers (legacy separate-voucher flow). */
export async function deletePendingEmbeddedVouchersInTx(
  tx: Prisma.TransactionClient,
  invoiceId: number,
  type: typeof VoucherType.SALE_RECEIPT | typeof VoucherType.PURCHASE_PAYMENT,
) {
  const links = await tx.invoiceVoucher.findMany({
    where: {
      invoiceId,
      voucher: { type, status: VoucherStatus.PENDING_APPROVAL },
    },
  });
  for (const link of links) {
    await tx.invoiceVoucher.delete({ where: { id: link.id } });
    await tx.voucher.delete({ where: { id: link.voucherId } });
  }
}

/**
 * Persist embedded receipt lines on the invoice (JSON + scalars).
 * Does NOT create separate SALE_RECEIPT vouchers — payment legs fold into SALE_INVOICE at post.
 */
export async function saveEmbeddedSaleReceiptsInTx(
  tx: Prisma.TransactionClient,
  data: {
    invoiceId: number;
    receipts: EmbeddedReceiptLineInput[];
  },
) {
  for (const receipt of data.receipts) {
    await assertBankOrCashAccount(tx, receipt.accountId, 'Receipt');
  }
  await deletePendingEmbeddedVouchersInTx(tx, data.invoiceId, VoucherType.SALE_RECEIPT);
  await tx.invoice.update({
    where: { id: data.invoiceId },
    data: embeddedReceiptScalarFields(data.receipts),
  });
}

/**
 * Persist embedded payment lines on the invoice (JSON + scalars).
 * Does NOT create separate PURCHASE_PAYMENT vouchers — payment legs fold into PURCHASE_INVOICE at post.
 */
export async function saveEmbeddedPurchasePaymentsInTx(
  tx: Prisma.TransactionClient,
  data: {
    invoiceId: number;
    payments: EmbeddedPaymentLineInput[];
  },
) {
  for (const payment of data.payments) {
    await assertBankOrCashAccount(tx, payment.accountId, 'Payment');
  }
  await deletePendingEmbeddedVouchersInTx(tx, data.invoiceId, VoucherType.PURCHASE_PAYMENT);
  await tx.invoice.update({
    where: { id: data.invoiceId },
    data: embeddedPaymentScalarFields(data.payments),
  });
}

/** @deprecated Prefer saveEmbeddedSaleReceiptsInTx — no longer creates SALE_RECEIPT vouchers. */
export async function syncEmbeddedSaleReceiptsInTx(
  tx: Prisma.TransactionClient,
  data: {
    invoiceId: number;
    customerAccountId: number;
    receipts: EmbeddedReceiptLineInput[];
    invoiceDate: Date;
    invoiceReference: string;
    createdById: number;
  },
) {
  void data.customerAccountId;
  void data.invoiceDate;
  void data.invoiceReference;
  void data.createdById;
  await saveEmbeddedSaleReceiptsInTx(tx, {
    invoiceId: data.invoiceId,
    receipts: data.receipts,
  });
}

/** @deprecated Prefer saveEmbeddedPurchasePaymentsInTx — no longer creates PURCHASE_PAYMENT vouchers. */
export async function syncEmbeddedPurchasePaymentsInTx(
  tx: Prisma.TransactionClient,
  data: {
    invoiceId: number;
    supplierAccountId: number;
    payments: EmbeddedPaymentLineInput[];
    invoiceDate: Date;
    invoiceReference: string;
    createdById: number;
  },
) {
  void data.supplierAccountId;
  void data.invoiceDate;
  void data.invoiceReference;
  void data.createdById;
  await saveEmbeddedPurchasePaymentsInTx(tx, {
    invoiceId: data.invoiceId,
    payments: data.payments,
  });
}

export async function resolveEmbeddedReceiptLinesForPosting(
  tx: Prisma.TransactionClient,
  invoice: {
    id: number;
    total: Prisma.Decimal | number;
    embeddedReceiptAmount: Prisma.Decimal | number | null;
    embeddedReceiptAccountId: number | null;
    embeddedReceiptLines?: unknown;
  },
): Promise<EmbeddedReceiptLineInput[]> {
  const fromJson = parseStoredEmbeddedLines(invoice.embeddedReceiptLines);
  if (fromJson.length > 0) {
    return parseEmbeddedReceiptLinesInput({ receipts: fromJson }, Number(invoice.total));
  }

  const links = await tx.invoiceVoucher.findMany({
    where: {
      invoiceId: invoice.id,
      voucher: { type: VoucherType.SALE_RECEIPT, status: VoucherStatus.PENDING_APPROVAL },
    },
    include: { voucher: true },
    orderBy: { id: 'asc' },
  });
  if (links.length > 0) {
    return parseEmbeddedReceiptLinesInput(
      {
        receipts: links.map((link) => ({
          amount: Number(link.voucher.amount),
          accountId: link.voucher.debitAccountId ?? undefined,
        })),
      },
      Number(invoice.total),
    );
  }

  return parseEmbeddedReceiptLinesInput(
    {
      receiptAmount:
        invoice.embeddedReceiptAmount != null ? Number(invoice.embeddedReceiptAmount) : undefined,
      receiptAccountId: invoice.embeddedReceiptAccountId ?? undefined,
    },
    Number(invoice.total),
  );
}

export async function resolveEmbeddedPaymentLinesForPosting(
  tx: Prisma.TransactionClient,
  invoice: {
    id: number;
    total: Prisma.Decimal | number;
    embeddedPaymentAmount: Prisma.Decimal | number | null;
    embeddedPaymentAccountId: number | null;
    embeddedPaymentLines?: unknown;
  },
): Promise<EmbeddedPaymentLineInput[]> {
  const fromJson = parseStoredEmbeddedLines(invoice.embeddedPaymentLines);
  if (fromJson.length > 0) {
    return parseEmbeddedPaymentLinesInput({ payments: fromJson }, Number(invoice.total));
  }

  const links = await tx.invoiceVoucher.findMany({
    where: {
      invoiceId: invoice.id,
      voucher: { type: VoucherType.PURCHASE_PAYMENT, status: VoucherStatus.PENDING_APPROVAL },
    },
    include: { voucher: true },
    orderBy: { id: 'asc' },
  });
  if (links.length > 0) {
    return parseEmbeddedPaymentLinesInput(
      {
        payments: links.map((link) => ({
          amount: Number(link.voucher.amount),
          accountId: link.voucher.creditAccountId ?? undefined,
        })),
      },
      Number(invoice.total),
    );
  }

  return parseEmbeddedPaymentLinesInput(
    {
      paymentAmount:
        invoice.embeddedPaymentAmount != null ? Number(invoice.embeddedPaymentAmount) : undefined,
      paymentAccountId: invoice.embeddedPaymentAccountId ?? undefined,
    },
    Number(invoice.total),
  );
}

export async function appendSaleReceiptLegsInTx(
  tx: Prisma.TransactionClient,
  legs: VoucherLeg[],
  data: {
    customerAccountId: number;
    receipts: EmbeddedReceiptLineInput[];
    invoiceReference: string;
  },
) {
  if (data.receipts.length === 0) return;

  const accounts = await Promise.all(
    data.receipts.map((receipt) => assertBankOrCashAccount(tx, receipt.accountId, 'Receipt')),
  );

  for (let i = 0; i < data.receipts.length; i++) {
    const receipt = data.receipts[i];
    const account = accounts[i];
    const label = formatBankCashAccountLabel(account.category.name, account.name);
    const description =
      data.receipts.length === 1
        ? `Receipt against Invoice #${data.invoiceReference}`
        : `Receipt against Invoice #${data.invoiceReference} (${label})`;

    legs.push({
      accountId: receipt.accountId,
      type: LedgerEntryType.DEBIT,
      amount: receipt.amount,
      description,
    });
    legs.push({
      accountId: data.customerAccountId,
      type: LedgerEntryType.CREDIT,
      amount: receipt.amount,
      description,
    });
  }
}

export async function appendPurchasePaymentLegsInTx(
  tx: Prisma.TransactionClient,
  legs: VoucherLeg[],
  data: {
    supplierAccountId: number;
    payments: EmbeddedPaymentLineInput[];
    invoiceReference: string;
  },
) {
  if (data.payments.length === 0) return;

  const accounts = await Promise.all(
    data.payments.map((payment) => assertBankOrCashAccount(tx, payment.accountId, 'Payment')),
  );

  for (let i = 0; i < data.payments.length; i++) {
    const payment = data.payments[i];
    const account = accounts[i];
    const label = formatBankCashAccountLabel(account.category.name, account.name);
    const description =
      data.payments.length === 1
        ? `Payment against Invoice #${data.invoiceReference}`
        : `Payment against Invoice #${data.invoiceReference} (${label})`;

    legs.push({
      accountId: data.supplierAccountId,
      type: LedgerEntryType.DEBIT,
      amount: payment.amount,
      description,
    });
    legs.push({
      accountId: payment.accountId,
      type: LedgerEntryType.CREDIT,
      amount: payment.amount,
      description,
    });
  }
}

export function assertLegsBalance(legs: VoucherLeg[], label: string) {
  const totalDebits = roundMoney(
    legs.filter((l) => l.type === LedgerEntryType.DEBIT).reduce((s, l) => s + l.amount, 0),
  );
  const totalCredits = roundMoney(
    legs.filter((l) => l.type === LedgerEntryType.CREDIT).reduce((s, l) => s + l.amount, 0),
  );
  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new AppError(500, `${label} voucher debits and credits do not balance`);
  }
}

export async function recomputeEmbeddedReceiptScalarsInTx(
  tx: Prisma.TransactionClient,
  invoiceId: number,
) {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId },
    select: { embeddedReceiptLines: true, total: true },
  });
  if (!invoice) return;

  const fromJson = parseStoredEmbeddedLines(invoice.embeddedReceiptLines);
  if (fromJson.length > 0) {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: embeddedReceiptScalarFields(fromJson),
    });
    return;
  }

  const links = await tx.invoiceVoucher.findMany({
    where: {
      invoiceId,
      voucher: {
        type: VoucherType.SALE_RECEIPT,
        status: { in: [VoucherStatus.PENDING_APPROVAL, VoucherStatus.ACTIVE] },
      },
    },
    include: { voucher: true },
    orderBy: { id: 'asc' },
  });

  if (links.length === 0) {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        embeddedReceiptAmount: null,
        embeddedReceiptAccountId: null,
        embeddedReceiptLines: Prisma.JsonNull,
      },
    });
    return;
  }

  const sum = roundMoney(links.reduce((total, link) => total + Number(link.voucher.amount), 0));
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      embeddedReceiptAmount: sum,
      embeddedReceiptAccountId: links[0].voucher.debitAccountId,
    },
  });
}

export async function recomputeEmbeddedPaymentScalarsInTx(
  tx: Prisma.TransactionClient,
  invoiceId: number,
) {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId },
    select: { embeddedPaymentLines: true, total: true },
  });
  if (!invoice) return;

  const fromJson = parseStoredEmbeddedLines(invoice.embeddedPaymentLines);
  if (fromJson.length > 0) {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: embeddedPaymentScalarFields(fromJson),
    });
    return;
  }

  const links = await tx.invoiceVoucher.findMany({
    where: {
      invoiceId,
      voucher: {
        type: VoucherType.PURCHASE_PAYMENT,
        status: { in: [VoucherStatus.PENDING_APPROVAL, VoucherStatus.ACTIVE] },
      },
    },
    include: { voucher: true },
    orderBy: { id: 'asc' },
  });

  if (links.length === 0) {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        embeddedPaymentAmount: null,
        embeddedPaymentAccountId: null,
        embeddedPaymentLines: Prisma.JsonNull,
      },
    });
    return;
  }

  const sum = roundMoney(links.reduce((total, link) => total + Number(link.voucher.amount), 0));
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      embeddedPaymentAmount: sum,
      embeddedPaymentAccountId: links[0].voucher.creditAccountId,
    },
  });
}

/**
 * Legacy helper: creates a separate SALE_RECEIPT voucher.
 * Kept for historical/tests; new invoices fold receipt legs into SALE_INVOICE instead.
 */
export async function createEmbeddedSaleReceiptInTx(
  tx: Prisma.TransactionClient,
  data: {
    invoiceId: number;
    customerAccountId: number;
    receipt: EmbeddedReceiptLineInput;
    invoiceDate: Date;
    invoiceReference: string;
    createdById: number;
  },
) {
  await assertBankOrCashAccount(tx, data.receipt.accountId, 'Receipt');

  const voucher = await createVoucherInTx(tx, {
    type: VoucherType.SALE_RECEIPT,
    debitAccountId: data.receipt.accountId,
    creditAccountId: data.customerAccountId,
    amount: data.receipt.amount,
    date: data.invoiceDate,
    description: `Receipt against Invoice #${data.invoiceReference}`,
    reference: `SR-${data.invoiceReference}`,
    createdById: data.createdById,
    postImmediately: false,
  });

  await tx.invoiceVoucher.create({
    data: { invoiceId: data.invoiceId, voucherId: voucher.id },
  });

  return voucher;
}

/**
 * Legacy helper: creates a separate PURCHASE_PAYMENT voucher.
 * Kept for historical/tests; new invoices fold payment legs into PURCHASE_INVOICE instead.
 */
export async function createEmbeddedPurchasePaymentInTx(
  tx: Prisma.TransactionClient,
  data: {
    invoiceId: number;
    supplierAccountId: number;
    payment: EmbeddedPaymentLineInput;
    invoiceDate: Date;
    invoiceReference: string;
    createdById: number;
  },
) {
  await assertBankOrCashAccount(tx, data.payment.accountId, 'Payment');

  const voucher = await createVoucherInTx(tx, {
    type: VoucherType.PURCHASE_PAYMENT,
    debitAccountId: data.supplierAccountId,
    creditAccountId: data.payment.accountId,
    amount: data.payment.amount,
    date: data.invoiceDate,
    description: `Payment against Invoice #${data.invoiceReference}`,
    reference: `PP-${data.invoiceReference}`,
    createdById: data.createdById,
    postImmediately: false,
  });

  await tx.invoiceVoucher.create({
    data: { invoiceId: data.invoiceId, voucherId: voucher.id },
  });

  return voucher;
}

export function formatBankCashAccountLabel(categoryName: string, accountName: string) {
  return `${categoryName} — ${accountName}`;
}
