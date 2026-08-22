import { Prisma, VoucherType } from '@prisma/client';
import { AppError } from '../../utils/helpers';
import { createVoucherInTx } from '../accounting/accounting.service';
import { roundMoney } from './sale-invoice.calculations';

function isBankOrCashCategory(name: string) {
  const n = name.trim().toLowerCase();
  return n.includes('bank') || n.includes('cash');
}

export type EmbeddedReceiptInput = {
  amount: number;
  accountId: number;
};

export type EmbeddedPaymentInput = {
  amount: number;
  accountId: number;
};

export function parseEmbeddedReceiptInput(
  receiptAmount: number | undefined,
  receiptAccountId: number | undefined,
  invoiceTotal: number,
): EmbeddedReceiptInput | null {
  const amount = receiptAmount != null ? roundMoney(receiptAmount) : 0;
  if (amount <= 0) {
    if (receiptAccountId != null) {
      throw new AppError(400, 'Receipt amount is required when a receipt account is selected');
    }
    return null;
  }
  if (receiptAccountId == null) {
    throw new AppError(400, 'Receipt account is required when receipt amount is greater than zero');
  }
  if (amount > invoiceTotal + 0.01) {
    throw new AppError(400, 'Receipt amount cannot exceed invoice total');
  }
  return { amount, accountId: receiptAccountId };
}

export function parseEmbeddedPaymentInput(
  paymentAmount: number | undefined,
  paymentAccountId: number | undefined,
  invoiceTotal: number,
): EmbeddedPaymentInput | null {
  const amount = paymentAmount != null ? roundMoney(paymentAmount) : 0;
  if (amount <= 0) {
    if (paymentAccountId != null) {
      throw new AppError(400, 'Payment amount is required when a payment account is selected');
    }
    return null;
  }
  if (paymentAccountId == null) {
    throw new AppError(400, 'Payment account is required when payment amount is greater than zero');
  }
  if (amount > invoiceTotal + 0.01) {
    throw new AppError(400, 'Payment amount cannot exceed invoice total');
  }
  return { amount, accountId: paymentAccountId };
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

export async function createEmbeddedSaleReceiptInTx(
  tx: Prisma.TransactionClient,
  data: {
    invoiceId: number;
    customerAccountId: number;
    receipt: EmbeddedReceiptInput;
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
    payment: EmbeddedPaymentInput;
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
