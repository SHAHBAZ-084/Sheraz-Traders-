import { Prisma, VoucherStatus, VoucherType } from '@prisma/client';
import { AppError } from '../../utils/helpers';
import { createVoucherInTx } from '../accounting/accounting.service';
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

async function deletePendingEmbeddedVouchersInTx(
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

export async function recomputeEmbeddedReceiptScalarsInTx(
  tx: Prisma.TransactionClient,
  invoiceId: number,
) {
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
      data: { embeddedReceiptAmount: null, embeddedReceiptAccountId: null },
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
      data: { embeddedPaymentAmount: null, embeddedPaymentAccountId: null },
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
  await deletePendingEmbeddedVouchersInTx(tx, data.invoiceId, VoucherType.SALE_RECEIPT);

  for (const receipt of data.receipts) {
    await createEmbeddedSaleReceiptInTx(tx, {
      invoiceId: data.invoiceId,
      customerAccountId: data.customerAccountId,
      receipt,
      invoiceDate: data.invoiceDate,
      invoiceReference: data.invoiceReference,
      createdById: data.createdById,
    });
  }

  if (data.receipts.length === 0) {
    await tx.invoice.update({
      where: { id: data.invoiceId },
      data: { embeddedReceiptAmount: null, embeddedReceiptAccountId: null },
    });
    return;
  }

  const sum = roundMoney(data.receipts.reduce((total, line) => total + line.amount, 0));
  await tx.invoice.update({
    where: { id: data.invoiceId },
    data: {
      embeddedReceiptAmount: sum,
      embeddedReceiptAccountId: data.receipts[0].accountId,
    },
  });
}

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
  await deletePendingEmbeddedVouchersInTx(tx, data.invoiceId, VoucherType.PURCHASE_PAYMENT);

  for (const payment of data.payments) {
    await createEmbeddedPurchasePaymentInTx(tx, {
      invoiceId: data.invoiceId,
      supplierAccountId: data.supplierAccountId,
      payment,
      invoiceDate: data.invoiceDate,
      invoiceReference: data.invoiceReference,
      createdById: data.createdById,
    });
  }

  if (data.payments.length === 0) {
    await tx.invoice.update({
      where: { id: data.invoiceId },
      data: { embeddedPaymentAmount: null, embeddedPaymentAccountId: null },
    });
    return;
  }

  const sum = roundMoney(data.payments.reduce((total, line) => total + line.amount, 0));
  await tx.invoice.update({
    where: { id: data.invoiceId },
    data: {
      embeddedPaymentAmount: sum,
      embeddedPaymentAccountId: data.payments[0].accountId,
    },
  });
}

export function formatBankCashAccountLabel(categoryName: string, accountName: string) {
  return `${categoryName} — ${accountName}`;
}
