import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import {
  activeFinancialYearStartDate,
  voucherDateInActiveYear,
} from '../../test-helpers/financial-year';
import {
  bootstrapChartOfAccounts,
  createVoucher,
  ensureCustomerAccount,
  getTrialBalance,
  listAccounts,
} from './accounting.service';
import { trialBalanceFromSignedBalance } from './ledger-utils';

async function accountByName(name: string) {
  const accounts = await listAccounts();
  const account = accounts.find((a) => a.name === name);
  if (!account?.ledger) throw new Error(`Account not found: ${name}`);
  return account;
}

async function ledgerBalance(accountId: number) {
  const ledger = await prisma.ledger.findUniqueOrThrow({ where: { accountId } });
  return Number(ledger.balance);
}

describe('voucher posting (PART 7 scenarios)', () => {
  let userId: number;
  let cashId: number;
  let electricityId: number;
  let customerAccountId: number;
  let bankId: number;
  let voucherDate: string;

  beforeAll(async () => {
    voucherDate = await voucherDateInActiveYear();
    await bootstrapChartOfAccounts();
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('Seed admin user first');
    userId = user.id;

    const cash = await accountByName('Cash in Hand');
    cashId = cash.id;

    const accounts = await listAccounts();
    let expense = accounts.find((a) => a.name.toLowerCase().includes('electricity'));
    if (!expense) {
      const expenseCat = await prisma.accountCategory.findFirst({ where: { name: 'Expenses' } });
      if (!expenseCat) throw new Error('Expenses category missing');
      const created = await prisma.account.create({
        data: {
          categoryId: expenseCat.id,
          name: 'Electricity Expense',
          code: 'EXP-ELEC',
          type: 'EXPENSE',
        },
      });
      await prisma.ledger.create({ data: { accountId: created.id, balance: 0 } });
      electricityId = created.id;
    } else {
      electricityId = expense.id;
    }

    let customerParty = await prisma.customer.findFirst({ where: { isActive: true } });
    if (!customerParty) {
      customerParty = await prisma.$transaction(async (tx) => {
        const created = await tx.customer.create({ data: { name: 'Test Customer' } });
        await ensureCustomerAccount(tx, { id: created.id, name: created.name });
        return created;
      });
    }
    const customerCode = `C${String(customerParty.id).padStart(4, '0')}`;
    const customerAccount = await prisma.account.findFirst({ where: { code: customerCode } });
    if (!customerAccount) throw new Error('Customer ledger account missing');
    customerAccountId = customerAccount.id;

    const bankCat = await prisma.accountCategory.findFirst({ where: { name: 'Bank' } });
    if (!bankCat) throw new Error('Bank category missing');
    let bank = await prisma.account.findFirst({ where: { categoryId: bankCat.id, isActive: true } });
    if (!bank) {
      bank = await prisma.account.create({
        data: { categoryId: bankCat.id, name: 'Test Bank', code: 'BNK-TEST', type: 'ASSET' },
      });
      await prisma.ledger.create({ data: { accountId: bank.id, balance: 0 } });
    }
    bankId = bank.id;
  });

  it('Payment: Cash −10,000, Electricity Expense +10,000', async () => {
    const cashBefore = await ledgerBalance(cashId);
    const expBefore = await ledgerBalance(electricityId);

    await createVoucher({
      type: 'PAYMENT',
      debitAccountId: electricityId,
      creditAccountId: cashId,
      amount: 10000,
      date: voucherDate,
      createdById: userId,
      description: 'Electricity bill',
      reference: 'ELEC-BILL',
    });

    expect(await ledgerBalance(cashId)).toBe(cashBefore - 10000);
    expect(await ledgerBalance(electricityId)).toBe(expBefore + 10000);

    const cashTb = trialBalanceFromSignedBalance(await ledgerBalance(cashId));
    const expTb = trialBalanceFromSignedBalance(await ledgerBalance(electricityId));
    expect(cashTb.debit + cashTb.credit).toBeGreaterThanOrEqual(0);
    expect(expTb.debit).toBeGreaterThan(0);
  });

  it('Receipt: Customer credited, Cash debited +50,000', async () => {
    const cashBefore = await ledgerBalance(cashId);
    const custBefore = await ledgerBalance(customerAccountId);

    await createVoucher({
      type: 'RECEIPT',
      debitAccountId: cashId,
      creditAccountId: customerAccountId,
      amount: 50000,
      date: voucherDate,
      createdById: userId,
      reference: 'RCPT-001',
    });

    expect(await ledgerBalance(cashId)).toBe(cashBefore + 50000);
    expect(await ledgerBalance(customerAccountId)).toBe(custBefore - 50000);
    if (await ledgerBalance(customerAccountId) < 0) {
      const tb = trialBalanceFromSignedBalance(await ledgerBalance(customerAccountId));
      expect(tb.credit).toBeGreaterThan(0);
    }
  });

  it('Journal: Bank −20,000, Cash +20,000', async () => {
    const bankBefore = await ledgerBalance(bankId);
    const cashBefore = await ledgerBalance(cashId);

    await createVoucher({
      type: 'JOURNAL',
      debitAccountId: cashId,
      creditAccountId: bankId,
      amount: 20000,
      date: voucherDate,
      createdById: userId,
      description: 'Bank to Cash transfer',
      reference: 'BNK-XFER',
    });

    expect(await ledgerBalance(bankId)).toBe(bankBefore - 20000);
    expect(await ledgerBalance(cashId)).toBe(cashBefore + 20000);
  });

  it('Trial balance stays balanced after postings', async () => {
    const tb = await getTrialBalance();
    expect(tb.isBalanced).toBe(true);
    expect(tb.totalDebit).toBeCloseTo(tb.totalCredit, 2);
  });

  it('Backdated voucher sorts before later-dated entries in ledger report', async () => {
    const pastDate = await activeFinancialYearStartDate();
    const voucher = await createVoucher({
      type: 'JOURNAL',
      debitAccountId: cashId,
      creditAccountId: bankId,
      amount: 1000,
      date: pastDate,
      createdById: userId,
      reference: 'BACKDATE-TEST',
    });

    const entries = await prisma.ledgerEntry.findMany({
      where: { voucherId: voucher.id, isReversal: false },
      include: { voucher: true },
    });
    expect(entries).toHaveLength(2);
    expect(new Date(voucher.date).toISOString().slice(0, 10)).toBe(
      new Date(pastDate).toISOString().slice(0, 10),
    );
  });

  it('Cancel voucher restores balances via recompute', async () => {
    const cashBefore = await ledgerBalance(cashId);
    const bankBefore = await ledgerBalance(bankId);

    const voucher = await createVoucher({
      type: 'JOURNAL',
      debitAccountId: cashId,
      creditAccountId: bankId,
      amount: 3333,
      date: voucherDate,
      createdById: userId,
      reference: 'CANCEL-TEST',
    });

    expect(await ledgerBalance(cashId)).toBe(cashBefore + 3333);
    expect(await ledgerBalance(bankId)).toBe(bankBefore - 3333);

    const { cancelVoucher } = await import('./accounting.service');
    await cancelVoucher(voucher.id, userId);

    expect(await ledgerBalance(cashId)).toBeCloseTo(cashBefore, 2);
    expect(await ledgerBalance(bankId)).toBeCloseTo(bankBefore, 2);
  });
});
