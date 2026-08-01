import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { voucherDateInActiveYear } from '../../test-helpers/financial-year';
import {
  bootstrapChartOfAccounts,
  cancelVoucher,
  createVoucher,
  listAccounts,
  previewNextVoucherNumber,
} from './accounting.service';

async function accountByName(name: string) {
  const accounts = await listAccounts();
  const account = accounts.find((a) => a.name === name);
  if (!account?.ledger) throw new Error(`Account not found: ${name}`);
  return account;
}

async function nextNumberForType(
  financialYearId: number,
  type: 'PAYMENT' | 'RECEIPT' | 'JOURNAL',
) {
  const { _max } = await prisma.voucher.aggregate({
    where: { financialYearId, type },
    _max: { number: true },
  });
  return (_max.number ?? 0) + 1;
}

describe('per-type voucher numbering', () => {
  let userId: number;
  let cashId: number;
  let electricityId: number;
  let bankId: number;
  let voucherDate: string;
  let financialYearId: number;

  beforeAll(async () => {
    voucherDate = await voucherDateInActiveYear();
    await bootstrapChartOfAccounts();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    const fy = await prisma.financialYear.findFirst({ where: { status: 'ACTIVE' } });
    if (!fy) throw new Error('No active financial year');
    financialYearId = fy.id;

    cashId = (await accountByName('Cash in Hand')).id;

    const accounts = await listAccounts();
    let expense = accounts.find((a) => a.name.toLowerCase().includes('electricity'));
    if (!expense) {
      const expenseCat = await prisma.accountCategory.findFirst({ where: { name: 'Expenses' } });
      if (!expenseCat) throw new Error('Expenses category missing');
      const created = await prisma.account.create({
        data: {
          categoryId: expenseCat.id,
          name: 'Electricity Expense',
          code: 'EXP-ELEC-NUM',
          type: 'EXPENSE',
        },
      });
      await prisma.ledger.create({ data: { accountId: created.id, balance: 0 } });
      electricityId = created.id;
    } else {
      electricityId = expense.id;
    }

    const bankCat = await prisma.accountCategory.findFirst({ where: { name: 'Bank' } });
    if (!bankCat) throw new Error('Bank category missing');
    let bank = await prisma.account.findFirst({ where: { categoryId: bankCat.id, isActive: true } });
    if (!bank) {
      bank = await prisma.account.create({
        data: { categoryId: bankCat.id, name: 'Test Bank', code: 'BNK-NUM', type: 'ASSET' },
      });
      await prisma.ledger.create({ data: { accountId: bank.id, balance: 0 } });
    }
    bankId = bank.id;
  });

  it('assigns independent sequences for Payment, Receipt, and Journal', async () => {
    const paymentPreview = await previewNextVoucherNumber('PAYMENT');
    const receiptPreview = await previewNextVoucherNumber('RECEIPT');
    const journalPreview = await previewNextVoucherNumber('JOURNAL');

    const payment = await createVoucher({
      type: 'PAYMENT',
      debitAccountId: electricityId,
      creditAccountId: cashId,
      amount: 100,
      date: voucherDate,
      createdById: userId,
      reference: 'NUM-PAY',
    });

    const receipt = await createVoucher({
      type: 'RECEIPT',
      debitAccountId: cashId,
      creditAccountId: bankId,
      amount: 100,
      date: voucherDate,
      createdById: userId,
      reference: 'NUM-RCPT',
    });

    const journal = await createVoucher({
      type: 'JOURNAL',
      debitAccountId: cashId,
      creditAccountId: bankId,
      amount: 100,
      date: voucherDate,
      createdById: userId,
      reference: 'NUM-JRN',
    });

    expect(payment.number).toBe(paymentPreview.number);
    expect(receipt.number).toBe(receiptPreview.number);
    expect(journal.number).toBe(journalPreview.number);

    // Each type advances only its own sequence
    expect(await nextNumberForType(financialYearId, 'PAYMENT')).toBe(payment.number + 1);
    expect(await nextNumberForType(financialYearId, 'RECEIPT')).toBe(receipt.number + 1);
    expect(await nextNumberForType(financialYearId, 'JOURNAL')).toBe(journal.number + 1);
  });

  it('does not reuse numbers after cancellation within the same type', async () => {
    const middle = await createVoucher({
      type: 'RECEIPT',
      debitAccountId: cashId,
      creditAccountId: bankId,
      amount: 50,
      date: voucherDate,
      createdById: userId,
      reference: 'NUM-CANCEL-MID',
    });

    await cancelVoucher(middle.id, userId);

    const after = await createVoucher({
      type: 'RECEIPT',
      debitAccountId: cashId,
      creditAccountId: bankId,
      amount: 50,
      date: voucherDate,
      createdById: userId,
      reference: 'NUM-AFTER-CANCEL',
    });

    expect(after.number).toBe(middle.number + 1);
    expect(after.number).not.toBe(middle.number);
  });

  it('previewNextVoucherNumber matches the next created voucher of that type', async () => {
    const preview = await previewNextVoucherNumber('JOURNAL');
    const voucher = await createVoucher({
      type: 'JOURNAL',
      debitAccountId: cashId,
      creditAccountId: bankId,
      amount: 10,
      date: voucherDate,
      createdById: userId,
      reference: 'NUM-PREVIEW',
    });
    expect(voucher.number).toBe(preview.number);
  });

  it('starts at 1 for a type with no vouchers in a financial year', async () => {
    const fy = await prisma.financialYear.create({
      data: {
        label: `TEST-EMPTY-FY-${Date.now()}`,
        startDate: new Date('2030-01-01'),
        status: 'CLOSED',
      },
    });
    expect(await nextNumberForType(fy.id, 'PAYMENT')).toBe(1);
    expect(await nextNumberForType(fy.id, 'RECEIPT')).toBe(1);
    expect(await nextNumberForType(fy.id, 'JOURNAL')).toBe(1);
  });
});
